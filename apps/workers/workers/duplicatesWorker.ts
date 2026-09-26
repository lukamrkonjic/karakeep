import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import cron from "node-cron";
import { withWorkerTracing } from "workerTracing";

import type {
  AlikePair,
  PictureVector,
  ZDuplicatePicturesRequest,
} from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  duplicatePicturesTable,
  pictureDuplicateScansTable,
  pictureEmbeddingsTable,
} from "@karakeep/db/schema";
import {
  alikePairs,
  bufferToVector,
  DuplicatePicturesQueue,
  getPictureSettings,
  orderedPair,
  queueDuplicatePicturesCheck,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import { MAX_DUPLICATE_DISTANCE } from "@karakeep/shared/types/duplicatePictures";

import { pictureOwners } from "./pictures/jobs";

/**
 * Fork: duplicate pictures, the way Immich finds its duplicates. Every night
 * (or only when asked: Settings → Pictures) the pictures that got their
 * fingerprint since the last check are compared with all of the user's
 * pictures. Pairs alike enough go to Cleanups → Duplicate pictures, where the
 * user keeps one. The fingerprints are the fingerprints job's
 * (workers/pictures/fingerprintsWorker.ts): a check waits for it to look at
 * new pictures first, and it queues the check when it's done.
 */

export const DuplicatePicturesSchedulingWorker = cron.schedule(
  "0 3 * * *",
  async () => {
    logger.info("[duplicates] Queueing the nightly duplicate-pictures check");
    try {
      for (const userId of await pictureOwners()) {
        const { duplicatesSchedule } = await getPictureSettings(db, userId);
        if (duplicatesSchedule === "nightly") {
          await queueDuplicatePicturesCheck(db, userId);
        }
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
        timeoutSecs: 3600,
      },
    );
  }
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

  // Everything with a fingerprint: each new one is compared with all of it.
  const compared: PictureVector[] = [];
  const fresh: PictureVector[] = [];
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
    (row.compared ? compared : fresh).push(picture);
  }

  const pairs = alikePairs(fresh, compared, MAX_DUPLICATE_DISTANCE);
  await savePairs(userId, pairs);
  // By id: a fingerprint made while this ran is compared next time.
  for (let i = 0; i < fresh.length; i += 400) {
    await db
      .update(pictureEmbeddingsTable)
      .set({ compared: true })
      .where(
        inArray(
          pictureEmbeddingsTable.bookmarkId,
          fresh.slice(i, i + 400).map((p) => p.id),
        ),
      );
  }

  await db
    .update(pictureDuplicateScansTable)
    .set({ status: "done", checkedAt: new Date(), error: null })
    .where(eq(pictureDuplicateScansTable.userId, userId));
  return `Compared ${fresh.length} new pictures of user ${userId} with ${compared.length}; ${pairs.length} new alike pairs`;
}
