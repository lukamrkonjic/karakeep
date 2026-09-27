import { workerStatsCounter } from "metrics";
import { withWorkerTracing } from "workerTracing";

import type { ZPictureJobRequest } from "@karakeep/shared-server";
import type { PaletteColour } from "@karakeep/shared/utils/colours";
import { db } from "@karakeep/db";
import { picturePalettesTable } from "@karakeep/db/schema";
import {
  getPictureSettings,
  paletteProgress,
  PicturePalettesQueue,
  readAsset,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import { colourSortKey } from "@karakeep/shared/utils/colours";

import { errorMessage, setPictureJob } from "./jobs";
import { paletteOf } from "./palette";

/**
 * Fork: the pictures' colours (Settings → Pictures → Colours) — each
 * picture's main colours (palette.ts), and its place when sorted by colour,
 * made once and again only when its file is replaced. A video goes by its
 * first frame. It runs after the fingerprints job (which queues it when
 * there's something to do), and when Colours is turned on.
 */

export class PicturePalettesWorker {
  static async build() {
    logger.info("Starting picture colours worker ...");
    return (await getQueueClient())!.createRunner<ZPictureJobRequest, string>(
      PicturePalettesQueue,
      {
        run: withWorkerTracing("palettesWorker.run", run),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("palettes", "completed").inc();
          logger.info(`[palettes][${job.id}] ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("palettes", "failed").inc();
          logger.error(`[palettes][${job.id}] Run failed: ${job.error}`);
          if (job.data?.userId) {
            await setPictureJob(job.data.userId, "palettes", {
              status: "failed",
              finishedAt: new Date(),
              error: errorMessage(job.error).slice(0, 500),
            });
          }
        },
      },
      // Milliseconds a picture: a whole library in minutes.
      { concurrency: 1, pollIntervalMs: 1000, timeoutSecs: 3 * 3600 },
    );
  }
}

async function run(job: DequeuedJob<ZPictureJobRequest>): Promise<string> {
  const { userId } = job.data;
  const finish = async (detail: string) => {
    await setPictureJob(userId, "palettes", {
      status: "done",
      finishedAt: new Date(),
      error: null,
      detail,
    });
    return `${detail} (user ${userId})`;
  };
  await setPictureJob(userId, "palettes", { status: "running", error: null });
  if (!(await getPictureSettings(db, userId)).palettesEnabled) {
    return finish("Colours are turned off");
  }

  const { todo } = await paletteProgress(db, userId);
  let unreadable = 0;
  for (const item of todo) {
    job.abortSignal.throwIfAborted();
    let colours: PaletteColour[] | null = null;
    try {
      const { asset } = await readAsset({ userId, assetId: item.assetId });
      colours = await paletteOf(asset);
    } catch (error) {
      // Not a picture the decoder reads (or gone): not tried again until
      // its file changes.
      unreadable++;
      logger.info(
        `[palettes][${job.id}] Couldn't read ${item.bookmarkId}: ${errorMessage(error)}`,
      );
    }
    const row = {
      userId,
      assetId: item.assetId,
      colours,
      sortKey: colours ? colourSortKey(colours) : null,
      createdAt: new Date(),
    };
    await db
      .insert(picturePalettesTable)
      .values({ bookmarkId: item.bookmarkId, ...row })
      .onConflictDoUpdate({ target: picturePalettesTable.bookmarkId, set: row })
      .catch(() => undefined); // deleted while this ran
  }
  return finish(
    todo.length === 0
      ? "Nothing new to look at"
      : `Looked at ${todo.length.toLocaleString()} pictures${unreadable ? ` (${unreadable} unreadable)` : ""}`,
  );
}
