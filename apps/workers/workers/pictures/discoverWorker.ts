import { promises as fs } from "fs";
import { and, asc, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import { fetchWithProxy } from "network";
import cron from "node-cron";
import { buildImpersonatingTRPCClient } from "trpc";
import { withWorkerTracing } from "workerTracing";

import type {
  ZDiscoverKeepRequest,
  ZPictureJobRequest,
} from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  bookmarks,
  discoverItemsTable,
  listSubscriptionImportsTable,
  pictureEmbeddingsTable,
} from "@karakeep/db/schema";
import {
  bufferToVector,
  buildPictureIndex,
  DiscoverKeepQueue,
  DiscoverQueue,
  getPictureSettings,
  requestDiscover,
  requestPictureFingerprints,
  vectorToBuffer,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import { tryCatch } from "@karakeep/shared/tryCatch";
import {
  BookmarkTypes,
  MAX_BOOKMARK_TITLE_LENGTH,
} from "@karakeep/shared/types/bookmarks";

import type { DiscoverCandidate } from "../connectors/pinterest";
import {
  discoverCandidateOf,
  fetchRelatedPins,
  openPinterestSession,
} from "../connectors/pinterest";
import { discardAsset, download, storeAsset } from "../subscriptionWorker";
import { rankCandidates } from "./discover";
import { errorMessage, pictureOwners, setPictureJob, userLists } from "./jobs";
import { pictureModel } from "./models";

/**
 * Fork: Discover (Settings → Pictures → Discover; the Discover page). A run
 * takes a dozen of the pins the user saved from Pinterest (their list
 * subscriptions' ledger), mostly recent ones, reads Pinterest's "more like
 * this" for each (connectors/pinterest.ts, as a visitor, a few seconds
 * apart), leaves out what they have or were offered before, looks at each
 * new picture's thumbnail with the picture model, and keeps the ones most
 * like their own pictures (discover.ts) for the page — up to a couple of
 * hundred waiting. Nightly or when asked. Keep (a job of its own) downloads
 * the picture like a subscription would and files it in the list.
 */

const ORIGIN = "https://www.pinterest.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// Saved pins a run starts from: most of them among the newest.
const RECENT_SEEDS = 8;
const OLDER_SEEDS = 4;
const RECENT_POOL = 60;
// Best new pictures a run adds, and how many may wait at most.
const ADDED_PER_RUN = 60;
const WAITING_MAX = 240;
// Waiting longer than this: not new anymore.
const STALE_MS = 30 * 24 * 3600_000;
const PAUSE_MS: [number, number] = [1500, 3500];
const THUMB_TIMEOUT_MS = 20_000;
const THUMB_MAX_BYTES = 5 * 1024 * 1024;

// Nightly at 4:00, after the duplicate-pictures check.
export const DiscoverSchedulingWorker = cron.schedule(
  "0 4 * * *",
  async () => {
    try {
      for (const userId of await pictureOwners()) {
        const settings = await getPictureSettings(db, userId);
        if (
          settings.discoverEnabled &&
          settings.discoverSchedule === "nightly"
        ) {
          await requestDiscover(db, userId);
        }
      }
    } catch (error) {
      logger.error(`[discover] Error queueing the runs: ${error}`);
    }
  },
  { runOnInit: false, scheduled: false },
);

export class DiscoverWorker {
  static async build() {
    logger.info("Starting discover worker ...");
    return (await getQueueClient())!.createRunner<ZPictureJobRequest, string>(
      DiscoverQueue,
      {
        run: withWorkerTracing("discoverWorker.run", run),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("discover", "completed").inc();
          logger.info(`[discover][${job.id}] ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("discover", "failed").inc();
          logger.error(`[discover][${job.id}] Run failed: ${job.error}`);
          if (job.data?.userId) {
            await setPictureJob(job.data.userId, "discover", {
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

export class DiscoverKeepWorker {
  static async build() {
    logger.info("Starting discover keep worker ...");
    return (await getQueueClient())!.createRunner<ZDiscoverKeepRequest, string>(
      DiscoverKeepQueue,
      {
        run: withWorkerTracing("discoverWorker.keep", keep),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("discoverKeep", "completed").inc();
          logger.info(`[discover][keep][${job.id}] ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("discoverKeep", "failed").inc();
          logger.error(`[discover][keep][${job.id}] Failed: ${job.error}`);
        },
      },
      { concurrency: 2, pollIntervalMs: 500, timeoutSecs: 600 },
    );
  }
}

const pause = (signal: AbortSignal) => {
  const [low, high] = PAUSE_MS;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, low + Math.random() * (high - low));
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
};

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The pins the user saved from Pinterest, newest first. */
async function savedPins(userId: string) {
  const rows = await db
    .select({
      pinId: listSubscriptionImportsTable.externalId,
      bookmarkId: listSubscriptionImportsTable.bookmarkId,
    })
    .from(listSubscriptionImportsTable)
    .innerJoin(
      bookmarks,
      eq(bookmarks.id, listSubscriptionImportsTable.bookmarkId),
    )
    .where(eq(listSubscriptionImportsTable.userId, userId))
    .orderBy(desc(bookmarks.createdAt));
  const seen = new Set<string>();
  // A pin's id is all digits (an Instagram post's code isn't; a carousel's
  // other pictures are "<pin>_<n>").
  return rows.filter(
    (r) => /^\d{6,}$/.test(r.pinId) && !seen.has(r.pinId) && seen.add(r.pinId),
  );
}

/** Pins and pictures the user has, or was offered before. */
async function known(userId: string) {
  const pins = new Set<string>();
  const media = new Set<string>();
  for (const row of await db
    .select({
      externalId: listSubscriptionImportsTable.externalId,
      mediaKey: listSubscriptionImportsTable.mediaKey,
    })
    .from(listSubscriptionImportsTable)
    .where(eq(listSubscriptionImportsTable.userId, userId))) {
    pins.add(row.externalId.split("_")[0]);
    if (row.mediaKey) {
      media.add(row.mediaKey);
    }
  }
  for (const row of await db
    .select({
      pinId: discoverItemsTable.pinId,
      mediaKey: discoverItemsTable.mediaKey,
    })
    .from(discoverItemsTable)
    .where(eq(discoverItemsTable.userId, userId))) {
    pins.add(row.pinId);
    if (row.mediaKey) {
      media.add(row.mediaKey);
    }
  }
  return { pins, media };
}

async function thumbnail(url: string, signal: AbortSignal): Promise<Buffer> {
  const resp = await fetchWithProxy(url, {
    headers: { "user-agent": UA, referer: `${ORIGIN}/` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(THUMB_TIMEOUT_MS)]),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > THUMB_MAX_BYTES) {
    throw new Error("too big for a thumbnail");
  }
  return buffer;
}

async function run(job: DequeuedJob<ZPictureJobRequest>): Promise<string> {
  const { userId } = job.data;
  const signal = job.abortSignal;
  const finish = async (detail: string) => {
    await setPictureJob(userId, "discover", {
      status: "done",
      finishedAt: new Date(),
      error: null,
      detail,
    });
    return `${detail} (user ${userId})`;
  };
  await setPictureJob(userId, "discover", { status: "running", error: null });
  if (!(await getPictureSettings(db, userId)).discoverEnabled) {
    return finish("Discover is turned off");
  }

  // Waiting too long: not new anymore.
  await db
    .delete(discoverItemsTable)
    .where(
      and(
        eq(discoverItemsTable.userId, userId),
        eq(discoverItemsTable.status, "new"),
        lt(discoverItemsTable.createdAt, new Date(Date.now() - STALE_MS)),
      ),
    );

  const saved = await savedPins(userId);
  if (saved.length === 0) {
    return finish(
      "Nothing to start from yet: it goes by pins you saved from Pinterest",
    );
  }
  const seeds = [
    ...shuffled(saved.slice(0, RECENT_POOL)).slice(0, RECENT_SEEDS),
    ...shuffled(saved.slice(RECENT_POOL)).slice(0, OLDER_SEEDS),
  ];

  // What Pinterest shows under each: the new ones.
  const { pins: knownPins, media: knownMedia } = await known(userId);
  const found = new Map<
    string,
    { candidate: DiscoverCandidate; seedBookmarkId: string | null }
  >();
  const session = await openPinterestSession(seeds[0].pinId, signal);
  let answered = 0;
  for (const seed of seeds) {
    await pause(signal);
    const { data: pins, error } = await tryCatch(
      fetchRelatedPins(session, seed.pinId, { signal }),
    );
    if (error) {
      signal.throwIfAborted();
      logger.warn(
        `[discover][${job.id}] "More like this" for pin ${seed.pinId}: ${errorMessage(error)}`,
      );
      continue;
    }
    answered++;
    for (const pin of pins) {
      const candidate = discoverCandidateOf(pin);
      if (
        !candidate ||
        knownPins.has(candidate.pinId) ||
        found.has(candidate.pinId) ||
        (candidate.mediaKey && knownMedia.has(candidate.mediaKey))
      ) {
        continue;
      }
      if (candidate.mediaKey) {
        knownMedia.add(candidate.mediaKey); // the same picture, pinned twice
      }
      found.set(candidate.pinId, {
        candidate,
        seedBookmarkId: seed.bookmarkId,
      });
    }
  }
  if (answered === 0) {
    throw new Error("Pinterest didn't answer for any of the saved pins");
  }
  if (found.size === 0) {
    return finish("Nothing new this time");
  }

  // Each one's thumbnail through the picture model.
  await pictureModel.use(async () => undefined, signal);
  const looked: { key: string; vector: Float32Array }[] = [];
  for (const [pinId, { candidate }] of found) {
    signal.throwIfAborted();
    try {
      const image = await thumbnail(candidate.thumb.url, signal);
      const { vector } = await pictureModel.use(
        (model) => model.embed(image),
        signal,
      );
      looked.push({ key: pinId, vector });
    } catch (error) {
      signal.throwIfAborted();
      logger.info(
        `[discover][${job.id}] Couldn't look at pin ${pinId}: ${errorMessage(error)}`,
      );
    }
  }

  const library = buildPictureIndex(
    (
      await db
        .select({
          id: pictureEmbeddingsTable.bookmarkId,
          embedding: pictureEmbeddingsTable.embedding,
        })
        .from(pictureEmbeddingsTable)
        .where(
          and(
            eq(pictureEmbeddingsTable.userId, userId),
            isNotNull(pictureEmbeddingsTable.embedding),
          ),
        )
    ).map((row) => ({ id: row.id, vector: bufferToVector(row.embedding!) })),
  );
  const skipped = (
    await db
      .select({ embedding: discoverItemsTable.embedding })
      .from(discoverItemsTable)
      .where(
        and(
          eq(discoverItemsTable.userId, userId),
          eq(discoverItemsTable.status, "skipped"),
          isNotNull(discoverItemsTable.embedding),
        ),
      )
  ).map((row) => bufferToVector(row.embedding!));
  const { listsOf, parents } = await userLists(userId);
  const vectors = new Map(looked.map((l) => [l.key, l.vector]));
  const ranked = rankCandidates({
    candidates: looked,
    library,
    skipped,
    listsOf: (id) => listsOf.get(id) ?? [],
    parentOf: (id) => parents.get(id) ?? null,
  }).slice(0, ADDED_PER_RUN);

  let added = 0;
  for (const { key, score, suggestedListId } of ranked) {
    const { candidate, seedBookmarkId } = found.get(key)!;
    const inserted = await db
      .insert(discoverItemsTable)
      .values({
        userId,
        pinId: candidate.pinId,
        mediaKey: candidate.mediaKey,
        title: candidate.title,
        thumbUrl: candidate.thumb.url,
        width: candidate.thumb.width,
        height: candidate.thumb.height,
        media: candidate.media,
        seedBookmarkId,
        embedding: vectorToBuffer(vectors.get(key)!),
        score,
        suggestedListId,
      })
      .onConflictDoNothing()
      .returning({ id: discoverItemsTable.id })
      .catch(() => []); // a list or the seed deleted meanwhile
    added += inserted.length;
  }

  // At most WAITING_MAX waiting: the least likely go.
  const waiting = await db
    .select({ id: discoverItemsTable.id })
    .from(discoverItemsTable)
    .where(
      and(
        eq(discoverItemsTable.userId, userId),
        eq(discoverItemsTable.status, "new"),
      ),
    )
    .orderBy(desc(discoverItemsTable.score), asc(discoverItemsTable.createdAt));
  const extra = waiting.slice(WAITING_MAX).map((row) => row.id);
  for (let i = 0; i < extra.length; i += 400) {
    await db
      .delete(discoverItemsTable)
      .where(inArray(discoverItemsTable.id, extra.slice(i, i + 400)));
  }

  return finish(
    added > 0
      ? `Found ${added} new pictures from ${answered} of your pins`
      : "Nothing new this time",
  );
}

async function keep(job: DequeuedJob<ZDiscoverKeepRequest>): Promise<string> {
  const item = await db.query.discoverItemsTable.findFirst({
    where: eq(discoverItemsTable.id, job.data.itemId),
  });
  if (!item || item.status !== "keeping") {
    return "Nothing to keep";
  }
  const { userId } = item;
  const pinUrl = `${ORIGIN}/pin/${item.pinId}/`;
  try {
    const client = await buildImpersonatingTRPCClient(userId);
    // One the user has meanwhile (from a board, say): filed, not copied.
    const [has] = await db
      .select({ bookmarkId: listSubscriptionImportsTable.bookmarkId })
      .from(listSubscriptionImportsTable)
      .where(
        and(
          eq(listSubscriptionImportsTable.userId, userId),
          isNotNull(listSubscriptionImportsTable.bookmarkId),
          or(
            eq(listSubscriptionImportsTable.externalId, item.pinId),
            item.mediaKey
              ? eq(listSubscriptionImportsTable.mediaKey, item.mediaKey)
              : undefined,
          ),
        ),
      )
      .limit(1);
    let bookmarkId = has?.bookmarkId ?? null;
    if (!bookmarkId) {
      const file = await download(
        {
          externalId: item.pinId,
          mediaKey: item.mediaKey,
          title: item.title,
          sourceUrl: pinUrl,
          media: item.media,
        },
        `${ORIGIN}/`,
      );
      let assetId: string;
      try {
        assetId = await storeAsset(userId, file);
      } finally {
        await tryCatch(fs.unlink(file.path));
      }
      try {
        const bookmark = await client.bookmarks.createBookmark({
          type: BookmarkTypes.ASSET,
          assetType: file.kind,
          assetId,
          fileName: file.fileName,
          sourceUrl: pinUrl,
          title: item.title?.slice(0, MAX_BOOKMARK_TITLE_LENGTH),
          source: "web",
        });
        bookmarkId = bookmark.id;
      } catch (error) {
        await discardAsset(userId, assetId);
        throw error;
      }
      // In the ledger, as if a subscription took it: a board with this pin
      // files this bookmark instead of downloading it again.
      await db
        .insert(listSubscriptionImportsTable)
        .values({
          userId,
          subscriptionId: null,
          externalId: item.pinId,
          mediaKey: item.mediaKey,
          bookmarkId,
        })
        .onConflictDoNothing();
    }
    if (item.listId) {
      await client.lists.addToList({ listId: item.listId, bookmarkId });
    }
    await db
      .update(discoverItemsTable)
      .set({ status: "kept", bookmarkId, decidedAt: new Date(), error: null })
      .where(eq(discoverItemsTable.id, item.id));
    // Its fingerprint, colours and list suggestions follow.
    await tryCatch(requestPictureFingerprints(db, userId));
    return `Kept pin ${item.pinId} (user ${userId})`;
  } catch (error) {
    // Back on the page, saying why.
    await db
      .update(discoverItemsTable)
      .set({ status: "new", error: errorMessage(error).slice(0, 300) })
      .where(eq(discoverItemsTable.id, item.id));
    return `Couldn't keep pin ${item.pinId}: ${errorMessage(error)}`;
  }
}
