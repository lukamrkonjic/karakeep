import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import cron from "node-cron";
import { withWorkerTracing } from "workerTracing";

import type { ZDuplicatePicturesRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
  duplicatePicturesTable,
  pictureDuplicateScansTable,
  pictureEmbeddingsTable,
} from "@karakeep/db/schema";
import {
  DuplicatePicturesQueue,
  queueDuplicatePicturesCheck,
  readAsset,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import { MAX_DUPLICATE_DISTANCE } from "@karakeep/shared/types/duplicatePictures";

import type { ClipModel } from "./duplicates/clip";
import type { AlikePair, PictureVector } from "./duplicates/pairs";
import { CLIP_MODEL_ID, openClipModel } from "./duplicates/clip";
import {
  alikePairs,
  alikePictures,
  bufferToVector,
  orderedPair,
  vectorToBuffer,
} from "./duplicates/pairs";

/**
 * Fork: duplicate pictures, the way Immich finds its duplicates. Every night
 * Immich's picture model (CLIP) looks at the pictures saved since the last
 * check — a video by its first frame — and compares each with all of the
 * user's pictures. Pairs alike enough go to Cleanups → Duplicate pictures,
 * where the user keeps one. The model (0.35 GB, downloaded into the data
 * folder the first time) is loaded only while there is something to look at.
 */

export const DuplicatePicturesSchedulingWorker = cron.schedule(
  "0 3 * * *",
  async () => {
    logger.info("[duplicates] Queueing the nightly duplicate-pictures check");
    try {
      const owners = await db
        .selectDistinct({ userId: bookmarks.userId })
        .from(bookmarkAssets)
        .innerJoin(bookmarks, eq(bookmarks.id, bookmarkAssets.id))
        .where(inArray(bookmarkAssets.assetType, ["image", "video"]));
      for (const { userId } of owners) {
        await queueDuplicatePicturesCheck(db, userId);
      }
    } catch (error) {
      logger.error(`[duplicates] Error queueing the checks: ${error}`);
    }
  },
  { runOnInit: false, scheduled: false },
);

export class DuplicatePicturesWorker {
  static async build() {
    logger.info("Starting duplicate pictures worker ...");
    return (await getQueueClient())!.createRunner<
      ZDuplicatePicturesRequest,
      string
    >(
      DuplicatePicturesQueue,
      {
        run: withWorkerTracing("duplicatesWorker.run", run),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("duplicates", "completed").inc();
          logger.info(`[duplicates][${job.id}] ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("duplicates", "failed").inc();
          logger.error(`[duplicates][${job.id}] Check failed: ${job.error}`);
          if (job.data?.userId) {
            await db
              .update(pictureDuplicateScansTable)
              .set({
                status: "failed",
                error: String(job.error?.message ?? job.error).slice(0, 500),
              })
              .where(eq(pictureDuplicateScansTable.userId, job.data.userId));
          }
        },
      },
      {
        concurrency: 1,
        pollIntervalMs: 1000,
        // A first check looks at the whole library, at a fraction of a
        // second a picture; one cut short carries on the next night.
        timeoutSecs: 6 * 3600,
      },
    );
  }
}

/** The user's pictures the model hasn't looked at (in their current form). */
async function picturesToLookAt(userId: string) {
  const rows = await db
    .select({
      bookmarkId: bookmarks.id,
      kind: bookmarkAssets.assetType,
      assetId: bookmarkAssets.assetId,
      lookedAt: pictureEmbeddingsTable.assetId,
      model: pictureEmbeddingsTable.model,
    })
    .from(bookmarks)
    .innerJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
    .leftJoin(
      pictureEmbeddingsTable,
      eq(pictureEmbeddingsTable.bookmarkId, bookmarks.id),
    )
    .where(
      and(
        eq(bookmarks.userId, userId),
        inArray(bookmarkAssets.assetType, ["image", "video"]),
      ),
    );
  // A video is looked at by its first frame, once the preprocessing worker
  // has made one.
  const posters = new Map(
    (
      await db
        .select({ bookmarkId: assets.bookmarkId, id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.userId, userId),
            eq(assets.assetType, AssetTypes.LINK_VIDEO_THUMBNAIL),
          ),
        )
    ).map((a) => [a.bookmarkId, a.id]),
  );
  return rows.flatMap((row) => {
    const assetId =
      row.kind === "image" ? row.assetId : posters.get(row.bookmarkId);
    if (!assetId || (row.lookedAt === assetId && row.model === CLIP_MODEL_ID)) {
      return [];
    }
    return [{ bookmarkId: row.bookmarkId, assetId, again: !!row.lookedAt }];
  });
}

/** Stores pairs, skipping any whose picture was deleted meanwhile. */
async function savePairs(userId: string, pairs: AlikePair[]) {
  for (const pair of pairs) {
    try {
      await db
        .insert(duplicatePicturesTable)
        .values({ userId, distance: pair.distance, ...orderedPair(pair) })
        .onConflictDoNothing();
    } catch {
      // A foreign key: one of the two was deleted while this ran.
    }
  }
}

async function run(job: DequeuedJob<ZDuplicatePicturesRequest>) {
  const { userId } = job.data;
  await db
    .insert(pictureDuplicateScansTable)
    .values({ userId, status: "running" })
    .onConflictDoUpdate({
      target: pictureDuplicateScansTable.userId,
      set: { status: "running", error: null },
    });

  // Everything the model has seen of this user's, in memory: each new
  // picture is compared with all of it.
  const seen = new Map<string, PictureVector>();
  const unfinished: PictureVector[] = [];
  for (const row of await db
    .select({
      id: pictureEmbeddingsTable.bookmarkId,
      embedding: pictureEmbeddingsTable.embedding,
      compared: pictureEmbeddingsTable.compared,
    })
    .from(pictureEmbeddingsTable)
    .where(
      and(
        eq(pictureEmbeddingsTable.userId, userId),
        isNotNull(pictureEmbeddingsTable.embedding),
      ),
    )) {
    const picture = { id: row.id, vector: bufferToVector(row.embedding!) };
    if (row.compared) {
      seen.set(row.id, picture);
    } else {
      unfinished.push(picture);
    }
  }

  // Pictures a check that was cut short looked at but didn't compare.
  if (unfinished.length > 0) {
    await savePairs(
      userId,
      alikePairs(unfinished, [...seen.values()], MAX_DUPLICATE_DISTANCE),
    );
    await db
      .update(pictureEmbeddingsTable)
      .set({ compared: true })
      .where(
        and(
          eq(pictureEmbeddingsTable.userId, userId),
          eq(pictureEmbeddingsTable.compared, false),
        ),
      );
    for (const picture of unfinished) {
      seen.set(picture.id, picture);
    }
  }

  const todo = await picturesToLookAt(userId);
  let model: ClipModel | null = null;
  let unreadable = 0;
  let found = 0;
  try {
    for (const item of todo) {
      job.abortSignal.throwIfAborted();
      model ??= await openClipModel(job.abortSignal);
      if (item.again) {
        // Its file was replaced: what it was alike no longer holds.
        seen.delete(item.bookmarkId);
        await db
          .delete(duplicatePicturesTable)
          .where(
            or(
              eq(duplicatePicturesTable.bookmarkId, item.bookmarkId),
              eq(duplicatePicturesTable.otherBookmarkId, item.bookmarkId),
            ),
          );
      }

      let looked: Awaited<ReturnType<ClipModel["embed"]>> | null = null;
      try {
        const { asset } = await readAsset({ userId, assetId: item.assetId });
        looked = await model.embed(asset);
      } catch (error) {
        // Not a picture the decoder reads (or gone): not tried again until
        // its file changes.
        unreadable++;
        logger.info(
          `[duplicates][${job.id}] Couldn't look at ${item.bookmarkId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const picture = looked
        ? { id: item.bookmarkId, vector: looked.vector }
        : null;
      const pairs = picture
        ? alikePictures(picture, seen.values(), MAX_DUPLICATE_DISTANCE)
        : [];
      const row = {
        userId,
        assetId: item.assetId,
        model: CLIP_MODEL_ID,
        embedding: looked ? vectorToBuffer(looked.vector) : null,
        width: looked?.width ?? null,
        height: looked?.height ?? null,
        compared: true,
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
      await savePairs(userId, pairs);
      found += pairs.length;
      if (picture) {
        seen.set(picture.id, picture);
      }
    }
  } finally {
    await model?.close();
  }

  await db
    .update(pictureDuplicateScansTable)
    .set({ status: "done", checkedAt: new Date(), error: null })
    .where(eq(pictureDuplicateScansTable.userId, userId));
  return `Looked at ${todo.length} pictures (${unreadable} unreadable) of user ${userId}; ${found} new alike pairs`;
}
