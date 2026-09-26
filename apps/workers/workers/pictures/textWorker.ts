import { desc, eq, inArray } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import { withWorkerTracing } from "workerTracing";

import type { ZPictureTextRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import { pictureTextQueriesTable } from "@karakeep/db/schema";
import { PictureTextQueue, vectorToBuffer } from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";

import { errorMessage } from "./jobs";
import { textModel } from "./models";

/**
 * Fork: search by description — the text half of the picture model turns a
 * description into a fingerprint, which the web app compares with the
 * pictures' (packages/trpc/routers/pictures.ts). The web app asks by adding
 * a row to pictureTextQueries and waits for it to be filled in; the model is
 * loaded on the first search (downloaded, the first time: 0.25 GB) and let
 * go of after ten minutes without one. Polled often: someone is waiting.
 */

/** Descriptions kept, the most recently searched. */
const KEEP = 1000;

export class PictureTextWorker {
  static async build() {
    logger.info("Starting picture text worker ...");
    return (await getQueueClient())!.createRunner<ZPictureTextRequest, string>(
      PictureTextQueue,
      {
        run: withWorkerTracing("pictureTextWorker.run", run),
        onComplete: async () => {
          workerStatsCounter.labels("pictureText", "completed").inc();
        },
        onError: async (job) => {
          workerStatsCounter.labels("pictureText", "failed").inc();
          logger.error(`[pictureText][${job.id}] Failed: ${job.error}`);
          if (job.data?.queryId) {
            await db
              .update(pictureTextQueriesTable)
              .set({ error: errorMessage(job.error).slice(0, 500) })
              .where(eq(pictureTextQueriesTable.id, job.data.queryId));
          }
        },
      },
      // The first search may download the model.
      { concurrency: 1, pollIntervalMs: 300, timeoutSecs: 15 * 60 },
    );
  }
}

async function run(job: DequeuedJob<ZPictureTextRequest>): Promise<string> {
  const query = await db.query.pictureTextQueriesTable.findFirst({
    where: eq(pictureTextQueriesTable.id, job.data.queryId),
  });
  if (!query || query.embedding) {
    return "Nothing to do";
  }
  const vector = await textModel.use(
    (model) => model.embed(query.text),
    job.abortSignal,
  );
  await db
    .update(pictureTextQueriesTable)
    .set({ embedding: vectorToBuffer(vector), error: null })
    .where(eq(pictureTextQueriesTable.id, query.id));

  // The oldest go once there are too many.
  const stale = await db
    .select({ id: pictureTextQueriesTable.id })
    .from(pictureTextQueriesTable)
    .orderBy(desc(pictureTextQueriesTable.usedAt))
    .limit(500)
    .offset(KEEP);
  if (stale.length > 0) {
    await db.delete(pictureTextQueriesTable).where(
      inArray(
        pictureTextQueriesTable.id,
        stale.map((s) => s.id),
      ),
    );
  }
  return `Described "${query.text.slice(0, 60)}"`;
}
