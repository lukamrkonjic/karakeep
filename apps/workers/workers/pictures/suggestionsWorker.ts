import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import { withWorkerTracing } from "workerTracing";

import type { ZPictureJobRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  pictureEmbeddingsTable,
  pictureListSuggestionsTable,
} from "@karakeep/db/schema";
import {
  bufferToVector,
  buildPictureIndex,
  getPictureSettings,
  PictureSuggestionsQueue,
  rankPictures,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import {
  SIMILAR_LEVELS,
  SUGGESTION_LEVELS,
  SUGGESTIONS_MONTH_MS,
} from "@karakeep/shared/types/pictures";

import { errorMessage, setPictureJob } from "./jobs";
import { suggestLists } from "./suggest";

/**
 * Fork: "Belongs in…" — list suggestions for new pictures (Settings →
 * Pictures). It runs once the fingerprints job has looked at them: each new
 * picture's closest matches among the user's pictures in lists say which list
 * it belongs in (suggest.ts). The picture's details and Cleanups → List
 * suggestions show them, to add or dismiss.
 */

// How many of a picture's closest matches vote, and how alike they must be
// at least (the loosest "similar").
const MATCHES = 15;
const MIN_SIMILARITY = 1 - SIMILAR_LEVELS.loose;

export class PictureSuggestionsWorker {
  static async build() {
    logger.info("Starting picture suggestions worker ...");
    return (await getQueueClient())!.createRunner<ZPictureJobRequest, string>(
      PictureSuggestionsQueue,
      {
        run: withWorkerTracing("suggestionsWorker.run", run),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("suggestions", "completed").inc();
          logger.info(`[suggestions][${job.id}] ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("suggestions", "failed").inc();
          logger.error(`[suggestions][${job.id}] Run failed: ${job.error}`);
          if (job.data?.userId) {
            await setPictureJob(job.data.userId, "suggestions", {
              status: "failed",
              finishedAt: new Date(),
              error: errorMessage(job.error).slice(0, 500),
            });
          }
        },
      },
      { concurrency: 1, pollIntervalMs: 1000, timeoutSecs: 3600 },
    );
  }
}

async function run(job: DequeuedJob<ZPictureJobRequest>): Promise<string> {
  const { userId } = job.data;
  const finish = async (detail: string) => {
    await setPictureJob(userId, "suggestions", {
      status: "done",
      finishedAt: new Date(),
      error: null,
      detail,
    });
    return `${detail} (user ${userId})`;
  };
  await setPictureJob(userId, "suggestions", {
    status: "running",
    error: null,
  });
  const settings = await getPictureSettings(db, userId);
  if (!settings.suggestionsEnabled) {
    return finish("List suggestions are turned off");
  }

  const fingerprints = await db
    .select({
      id: pictureEmbeddingsTable.bookmarkId,
      embedding: pictureEmbeddingsTable.embedding,
      suggested: pictureEmbeddingsTable.suggested,
      savedAt: bookmarks.dbCreatedAt,
    })
    .from(pictureEmbeddingsTable)
    .innerJoin(bookmarks, eq(bookmarks.id, pictureEmbeddingsTable.bookmarkId))
    .where(
      and(
        eq(pictureEmbeddingsTable.userId, userId),
        isNotNull(pictureEmbeddingsTable.embedding),
      ),
    );
  const from =
    settings.suggestionsScope === "all"
      ? 0
      : settings.suggestionsScope === "month"
        ? Date.now() - SUGGESTIONS_MONTH_MS
        : settings.suggestionsSince.getTime();
  const candidates = fingerprints.filter(
    (f) => !f.suggested && f.savedAt.getTime() >= from,
  );
  if (candidates.length === 0) {
    return finish("Nothing new to suggest a list for");
  }

  // The user's own lists, and what's in them.
  const listsOf = new Map<string, string[]>();
  for (const row of await db
    .select({
      bookmarkId: bookmarksInLists.bookmarkId,
      listId: bookmarksInLists.listId,
    })
    .from(bookmarksInLists)
    .innerJoin(bookmarkLists, eq(bookmarkLists.id, bookmarksInLists.listId))
    .where(
      and(eq(bookmarkLists.userId, userId), eq(bookmarkLists.type, "manual")),
    )) {
    listsOf.set(row.bookmarkId, [
      ...(listsOf.get(row.bookmarkId) ?? []),
      row.listId,
    ]);
  }
  const parents = new Map(
    (
      await db
        .select({ id: bookmarkLists.id, parentId: bookmarkLists.parentId })
        .from(bookmarkLists)
        .where(eq(bookmarkLists.userId, userId))
    ).map((l) => [l.id, l.parentId]),
  );

  const vectors = new Map(
    fingerprints.map((f) => [f.id, bufferToVector(f.embedding!)]),
  );
  const index = buildPictureIndex(
    [...vectors].map(([id, vector]) => ({ id, vector })),
  );
  const level = SUGGESTION_LEVELS[settings.suggestionsLevel];

  let suggested = 0;
  let pictures = 0;
  for (const candidate of candidates) {
    job.abortSignal.throwIfAborted();
    const own = new Set(listsOf.get(candidate.id) ?? []);
    const matches = rankPictures(index, vectors.get(candidate.id)!, {
      minSimilarity: MIN_SIMILARITY,
      exclude: new Set([candidate.id]),
      // Only a match in a list this picture isn't in says anything.
      only: (id) => (listsOf.get(id) ?? []).some((l) => !own.has(l)),
      limit: MATCHES,
    });
    const found = suggestLists({
      matches,
      listsOf: (id) => listsOf.get(id) ?? [],
      own,
      parentOf: (id) => parents.get(id) ?? null,
      level,
    });
    if (found.length > 0) {
      pictures++;
      suggested += found.length;
      // One added or dismissed before is never suggested again.
      await db
        .insert(pictureListSuggestionsTable)
        .values(
          found.map((s) => ({
            userId,
            bookmarkId: candidate.id,
            listId: s.listId,
            score: s.score,
          })),
        )
        .onConflictDoNothing()
        .catch(() => undefined); // deleted while this ran
    }
  }
  for (let i = 0; i < candidates.length; i += 400) {
    await db
      .update(pictureEmbeddingsTable)
      .set({ suggested: true })
      .where(
        inArray(
          pictureEmbeddingsTable.bookmarkId,
          candidates.slice(i, i + 400).map((c) => c.id),
        ),
      );
  }
  return finish(
    `Looked at ${candidates.length.toLocaleString()} new pictures: ${suggested} suggestions for ${pictures}`,
  );
}
