import { and, eq, or } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import cron from "node-cron";
import { withWorkerTracing } from "workerTracing";

import type { ZPictureJobRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  duplicatePicturesTable,
  pictureDuplicateScansTable,
  pictureEmbeddingsTable,
  pictureJobRunsTable,
  pictureListSuggestionsTable,
} from "@karakeep/db/schema";
import {
  CLIP_MODEL_ID,
  fingerprintProgress,
  getPictureSettings,
  paletteProgress,
  PictureFingerprintsQueue,
  queueDuplicatePicturesCompare,
  queueListSuggestions,
  readAsset,
  requestPictureFingerprints,
  requestPicturePalettes,
  vectorToBuffer,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";

import { errorMessage, pictureOwners, setPictureJob } from "./jobs";
import { pictureModel } from "./models";
import { videoLength, withAssetFile } from "./video";

/**
 * Fork: picture fingerprints — the picture model's embedding of every
 * picture (a video by its first frame, whether it's a video bookmark or on a
 * note or link, and by its length: a video matches only one as long), made
 * once and again only when the file is replaced. Every hour, every night or
 * only when asked (Settings → Pictures). Duplicate pictures and list
 * suggestions work on them: asking for either marks it "waiting" and asks
 * for this job, which queues what waits when it's done — and the pictures'
 * colours after it.
 */

// On the half hour, after the hourly subscription syncs (on the hour); the
// nightly run at 2:30, before the duplicate-pictures check at 3:00.
export const PictureFingerprintsSchedulingWorker = cron.schedule(
  "30 * * * *",
  async () => {
    const nightly = new Date().getHours() === 2;
    try {
      for (const userId of await pictureOwners()) {
        const { fingerprintSchedule } = await getPictureSettings(db, userId);
        const due =
          fingerprintSchedule === "hourly" ||
          (fingerprintSchedule === "nightly" && nightly);
        if (due && (await fingerprintProgress(db, userId)).todo.length > 0) {
          await requestPictureFingerprints(db, userId);
        }
      }
    } catch (error) {
      logger.error(`[fingerprints] Error queueing the runs: ${error}`);
    }
  },
  { runOnInit: false, scheduled: false },
);

export class PictureFingerprintsWorker {
  static async build() {
    logger.info("Starting picture fingerprints worker ...");
    return (await getQueueClient())!.createRunner<ZPictureJobRequest, string>(
      PictureFingerprintsQueue,
      {
        run: withWorkerTracing("fingerprintsWorker.run", run),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("fingerprints", "completed").inc();
          logger.info(`[fingerprints][${job.id}] ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("fingerprints", "failed").inc();
          logger.error(`[fingerprints][${job.id}] Run failed: ${job.error}`);
          if (job.data?.userId) {
            await setPictureJob(job.data.userId, "fingerprints", {
              status: "failed",
              finishedAt: new Date(),
              error: errorMessage(job.error).slice(0, 500),
            });
          }
        },
      },
      {
        concurrency: 1,
        pollIntervalMs: 1000,
        // A first run looks at the whole library, at a fraction of a second
        // a picture; one cut short carries on at the next.
        timeoutSecs: 6 * 3600,
      },
    );
  }
}

/** Queues the jobs waiting for this one, and new pictures' suggestions. */
async function queueWhatWaits(userId: string, made: number) {
  const scan = await db.query.pictureDuplicateScansTable.findFirst({
    where: eq(pictureDuplicateScansTable.userId, userId),
  });
  if (scan?.status === "waiting") {
    await queueDuplicatePicturesCompare(db, userId);
  }
  const suggestions = await db.query.pictureJobRunsTable.findFirst({
    where: and(
      eq(pictureJobRunsTable.userId, userId),
      eq(pictureJobRunsTable.job, "suggestions"),
    ),
  });
  const { suggestionsEnabled, palettesEnabled } = await getPictureSettings(
    db,
    userId,
  );
  if (suggestions?.status === "waiting" || (suggestionsEnabled && made > 0)) {
    await queueListSuggestions(db, userId);
  }
  // Colours follow the index: new pictures get theirs after it.
  if (palettesEnabled && (await paletteProgress(db, userId)).todo.length > 0) {
    await requestPicturePalettes(db, userId);
  }
}

/** A video's length, measured on its own file; 0 when it can't be. */
async function lengthOf(userId: string, videoAssetId: string) {
  try {
    return await withAssetFile(userId, videoAssetId, videoLength);
  } catch {
    return 0;
  }
}

/** Its duplicate pairs, which a changed fingerprint may no longer make. */
async function forgetPairs(bookmarkId: string) {
  await db
    .delete(duplicatePicturesTable)
    .where(
      and(
        eq(duplicatePicturesTable.status, "open"),
        or(
          eq(duplicatePicturesTable.bookmarkId, bookmarkId),
          eq(duplicatePicturesTable.otherBookmarkId, bookmarkId),
        ),
      ),
    );
}

async function run(job: DequeuedJob<ZPictureJobRequest>): Promise<string> {
  const { userId } = job.data;
  await setPictureJob(userId, "fingerprints", {
    status: "running",
    error: null,
  });

  // Every picture without a fingerprint of its current file — the whole
  // library the first time (shared-server's pictureSources.ts says which).
  const { todo: all } = await fingerprintProgress(db, userId);
  // Videos fingerprinted before their length was kept: measured only (a
  // look at the file's header, no model), then compared again.
  const lengthOnly = all.filter((item) => item.lengthOnly);
  for (const item of lengthOnly) {
    job.abortSignal.throwIfAborted();
    const duration = await lengthOf(userId, item.videoAssetId!);
    await forgetPairs(item.bookmarkId);
    await db
      .update(pictureEmbeddingsTable)
      .set({ duration, compared: false })
      .where(eq(pictureEmbeddingsTable.bookmarkId, item.bookmarkId));
  }
  const todo = all.filter((item) => !item.lengthOnly);
  if (todo.length > 0) {
    // Loaded — downloaded, the first time — before the first picture: a
    // model that can't be had fails the run, not every picture.
    await pictureModel.use(async () => undefined, job.abortSignal);
  }
  let made = 0;
  let unreadable = 0;
  for (const item of todo) {
    job.abortSignal.throwIfAborted();
    let looked: { vector: Float32Array; width: number; height: number } | null =
      null;
    try {
      const { asset } = await readAsset({ userId, assetId: item.assetId });
      looked = await pictureModel.use(
        (model) => model.embed(asset),
        job.abortSignal,
      );
    } catch (error) {
      if (job.abortSignal.aborted) {
        throw error;
      }
      // Not a picture the decoder reads (or gone): not tried again until
      // its file changes.
      unreadable++;
      logger.info(
        `[fingerprints][${job.id}] Couldn't look at ${item.bookmarkId}: ${errorMessage(error)}`,
      );
    }
    if (item.again) {
      // Its file was replaced: what it was alike, or suggested for, no
      // longer holds.
      await db
        .delete(duplicatePicturesTable)
        .where(
          or(
            eq(duplicatePicturesTable.bookmarkId, item.bookmarkId),
            eq(duplicatePicturesTable.otherBookmarkId, item.bookmarkId),
          ),
        );
      await db
        .delete(pictureListSuggestionsTable)
        .where(
          and(
            eq(pictureListSuggestionsTable.bookmarkId, item.bookmarkId),
            eq(pictureListSuggestionsTable.status, "open"),
          ),
        );
    }
    const row = {
      userId,
      assetId: item.assetId,
      model: CLIP_MODEL_ID,
      embedding: looked ? vectorToBuffer(looked.vector) : null,
      width: looked?.width ?? null,
      height: looked?.height ?? null,
      duration:
        looked && item.videoAssetId
          ? await lengthOf(userId, item.videoAssetId)
          : null,
      // The duplicate-pictures check and list suggestions look at it next;
      // one that couldn't be read has nothing for them.
      compared: !looked,
      suggested: !looked,
      // When it got this fingerprint: the web app's caches go by it.
      createdAt: new Date(),
    };
    try {
      await db
        .insert(pictureEmbeddingsTable)
        .values({ bookmarkId: item.bookmarkId, ...row })
        .onConflictDoUpdate({
          target: pictureEmbeddingsTable.bookmarkId,
          set: row,
        });
    } catch {
      continue; // deleted while this ran
    }
    if (looked) {
      made++;
    }
  }

  const measured =
    lengthOnly.length > 0
      ? `measured ${lengthOnly.length.toLocaleString()} videos`
      : null;
  const detail =
    todo.length === 0
      ? measured
        ? `Nothing new to look at; ${measured}`
        : "Nothing new to look at"
      : `Looked at ${todo.length.toLocaleString()} pictures${unreadable ? ` (${unreadable} unreadable)` : ""}${measured ? `; ${measured}` : ""}`;
  await setPictureJob(userId, "fingerprints", {
    status: "done",
    finishedAt: new Date(),
    error: null,
    detail,
  });
  await queueWhatWaits(userId, made);
  return `${detail} (user ${userId})`;
}
