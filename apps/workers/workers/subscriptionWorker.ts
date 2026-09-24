import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { and, eq, isNotNull, max } from "drizzle-orm";
import {
  ACCEPTED_IMAGE_TYPES,
  CONVERTIBLE_IMAGE_TYPES,
  convertForStorage,
} from "imageFormats";
import { workerStatsCounter } from "metrics";
import { fetchWithProxy } from "network";
import cron from "node-cron";
import {
  buildImpersonatingAuthedContext,
  buildImpersonatingTRPCClient,
} from "trpc";
import { TRPCError } from "@trpc/server";
import { withWorkerTracing } from "workerTracing";

import type { ZSubscriptionRequestSchema } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import type { InstagramCookies } from "@karakeep/shared/utils/instagram";
import {
  assets,
  AssetTypes,
  bookmarks,
  instagramSessionsTable,
  listSubscriptionImportsTable,
  listSubscriptionsTable,
  users,
} from "@karakeep/db/schema";
import {
  deleteAsset,
  INSTAGRAM_SESSION_PURPOSE,
  InstagramSessionError,
  newAssetId,
  openSecret,
  QuotaService,
  queueSubscriptionSync,
  saveAssetFromFile,
  StorageQuotaError,
  SubscriptionQueue,
} from "@karakeep/shared-server";
import { VIDEO_ASSET_TYPES } from "@karakeep/shared/assetdb";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";
import { tryCatch } from "@karakeep/shared/tryCatch";
import {
  BookmarkTypes,
  MAX_BOOKMARK_TITLE_LENGTH,
} from "@karakeep/shared/types/bookmarks";
import { List } from "@karakeep/trpc/models/lists";

import { fetchInstagramCollection } from "./connectors/instagram";
import { fetchPinterestBoard } from "./connectors/pinterest";
import type {
  SubscriptionFetchResult,
  SubscriptionItem,
  SubscriptionMedia,
} from "./connectors/types";
import { normalizeContentType } from "./crawler/utils";

/**
 * Fork: keeps a list in sync with a source — a public Pinterest board
 * (connectors/pinterest.ts) or one of the user's Instagram saved collections,
 * read with the session they pasted (connectors/instagram.ts).
 *
 * Modelled on the RSS feed worker: an hourly cron queues whatever is due, the
 * runner fetches the board and files what is new. The ledger
 * (listSubscriptionImports) makes sure nothing is downloaded twice: a pin a
 * subscription has handled is never touched again — even after its bookmark
 * was moved or deleted — and a picture the user already has (the same image
 * pinned twice, or a board that was removed and added again) is linked into
 * the list instead of being downloaded a second time.
 */

type SubscriptionRunResult = "success" | "failure" | "skipped";

/** A source bigger than this finishes over several runs, queued back to back. */
const MAX_NEW_PER_RUN: Record<Subscription["kind"], number> = {
  pinterest: 300,
  // Every run pages from the top down to what it has, and Instagram is paged
  // slowly: fewer, bigger runs.
  instagram: 500,
};
const FETCH_TIMEOUT_MS: Record<Subscription["kind"], number> = {
  pinterest: 5 * 60_000,
  instagram: 20 * 60_000,
};
const SOURCES: Record<Subscription["kind"], { name: string; referer: string }> =
  {
    pinterest: { name: "Pinterest", referer: "https://www.pinterest.com/" },
    instagram: { name: "Instagram", referer: "https://www.instagram.com/" },
  };
const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
/** Consecutive download failures after which the source is assumed down. */
const MAX_FAILURES_IN_A_ROW = 5;
/** The cron fires on the hour; a run that finished a few minutes past the
 *  hour must still count as due on the hour it is next due. */
const SCHEDULE_SLACK_MS = 10 * 60_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const SubscriptionRefreshingWorker = cron.schedule(
  "0 * * * *",
  async () => {
    logger.info("[subscription] Looking for subscriptions to sync ...");
    try {
      const rows = await db
        .select({
          id: listSubscriptionsTable.id,
          userId: listSubscriptionsTable.userId,
          lastRunAt: listSubscriptionsTable.lastRunAt,
          intervalHours: users.subscriptionIntervalHours,
        })
        .from(listSubscriptionsTable)
        .innerJoin(users, eq(users.id, listSubscriptionsTable.userId))
        .where(eq(listSubscriptionsTable.enabled, true));

      const now = Date.now();
      for (const row of rows) {
        // 0 hours means this user syncs only when they ask for it.
        if (row.intervalHours <= 0) {
          continue;
        }
        const due =
          !row.lastRunAt ||
          now - row.lastRunAt.getTime() >=
            row.intervalHours * 3600_000 - SCHEDULE_SLACK_MS;
        if (due) {
          await queueSubscriptionSync(db, row);
        }
      }
    } catch (error) {
      logger.error(
        `[subscription] Error scheduling subscription jobs: ${error}`,
      );
    }
  },
  {
    runOnInit: false,
    scheduled: false,
  },
);

export class SubscriptionWorker {
  static async build() {
    logger.info("Starting subscription worker ...");
    return (await getQueueClient())!.createRunner<
      ZSubscriptionRequestSchema,
      SubscriptionRunResult
    >(
      SubscriptionQueue,
      {
        run: withWorkerTracing("subscriptionWorker.run", run),
        onComplete: async (job, result) => {
          workerStatsCounter.labels("subscription", "completed").inc();
          logger.info(`[subscription][${job.id}] Completed: ${result}`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("subscription", "failed").inc();
          logger.error(
            `[subscription][${job.id}] Sync job failed: ${job.error}`,
          );
          if (job.data?.subscriptionId) {
            await db
              .update(listSubscriptionsTable)
              .set({
                lastRunAt: new Date(),
                lastStatus: "failure",
                lastError: errorMessage(job.error).slice(0, 500),
              })
              .where(eq(listSubscriptionsTable.id, job.data.subscriptionId));
          }
        },
      },
      {
        concurrency: 1,
        pollIntervalMs: 1000,
        // A first sync downloads a lot of pictures, and videos are big.
        timeoutSecs: 30 * 60,
      },
    );
  }
}

/** This item will never import (gone, not a picture, too big): remember it. */
class PermanentSkip extends Error {}
/** Nothing else in this run can succeed either (quota, lost the list). */
class StopRun extends Error {}
class TooBig extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Subscription = typeof listSubscriptionsTable.$inferSelect;
type TRPCClient = Awaited<ReturnType<typeof buildImpersonatingTRPCClient>>;

interface DownloadedFile {
  path: string;
  kind: SubscriptionMedia["kind"];
  contentType: string;
  size: number;
  fileName: string;
}

function fileNameOf(url: string, fallback: string): string {
  const last = new URL(url).pathname.split("/").pop() ?? "";
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // a malformed escape: keep it as it came
  }
  return name.replace(/[^\x20-\x7E]/g, "_").slice(0, 120) || fallback;
}

/** Let go of a response body we won't read. */
function discard(resp: { body: unknown }) {
  const body = resp.body as {
    destroy?: () => void;
    cancel?: () => Promise<void>;
  } | null;
  body?.destroy?.();
  void body?.cancel?.().catch(() => undefined);
}

async function downloadOne(
  media: SubscriptionMedia,
  fallbackName: string,
  referer: string,
): Promise<DownloadedFile> {
  const maxBytes = serverConfig.maxAssetSizeMb * 1024 * 1024;
  const resp = await fetchWithProxy(media.url, {
    headers: {
      "user-agent": UA,
      referer,
      // Whatever can be kept (or converted to something that can): a CDN
      // picks the best format the request allows.
      accept:
        media.kind === "video"
          ? [...VIDEO_ASSET_TYPES].join(",")
          : [...ACCEPTED_IMAGE_TYPES].join(","),
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!resp.ok || !resp.body) {
    discard(resp);
    const message = `HTTP ${resp.status}`;
    // A 4xx won't fix itself; a 5xx might.
    throw resp.status >= 400 && resp.status < 500
      ? new PermanentSkip(message)
      : new Error(message);
  }
  const contentType = normalizeContentType(resp.headers.get("content-type"));
  const allowed =
    media.kind === "video" ? VIDEO_ASSET_TYPES : ACCEPTED_IMAGE_TYPES;
  if (!contentType || !allowed.has(contentType)) {
    discard(resp);
    throw new PermanentSkip(`unsupported type ${contentType ?? "(none)"}`);
  }
  const declared = Number(resp.headers.get("content-length"));
  if (declared > maxBytes) {
    discard(resp);
    throw new PermanentSkip(
      `bigger than ${serverConfig.maxAssetSizeMb} MB (MAX_ASSET_SIZE_MB)`,
    );
  }

  // Streamed to disk, never held in memory: a video can be large.
  const tempPath = path.join(
    os.tmpdir(),
    `karakeep-subscription-${newAssetId()}`,
  );
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > maxBytes ? new TooBig() : null, chunk);
    },
  });
  try {
    await pipeline(resp.body, limit, fsSync.createWriteStream(tempPath));
  } catch (error) {
    await tryCatch(fs.unlink(tempPath));
    if (error instanceof TooBig) {
      throw new PermanentSkip(
        `bigger than ${serverConfig.maxAssetSizeMb} MB (MAX_ASSET_SIZE_MB)`,
      );
    }
    throw error;
  }
  if (size === 0) {
    await tryCatch(fs.unlink(tempPath));
    throw new PermanentSkip("empty response");
  }
  const fileName = fileNameOf(media.url, fallbackName);
  if (!CONVERTIBLE_IMAGE_TYPES.has(contentType)) {
    return { path: tempPath, kind: media.kind, contentType, size, fileName };
  }

  // A format no browser shows (TIFF): kept as a PNG of it.
  const pngPath = `${tempPath}.png`;
  try {
    const pngSize = await convertForStorage(tempPath, pngPath);
    if (pngSize > maxBytes) {
      throw new TooBig();
    }
    return {
      path: pngPath,
      kind: media.kind,
      contentType: "image/png",
      size: pngSize,
      fileName: `${fileName.replace(/\.[^.]*$/, "")}.png`,
    };
  } catch (error) {
    await tryCatch(fs.unlink(pngPath));
    throw new PermanentSkip(
      error instanceof TooBig
        ? `bigger than ${serverConfig.maxAssetSizeMb} MB (MAX_ASSET_SIZE_MB) as a PNG`
        : `couldn't convert ${contentType}: ${errorMessage(error)}`,
    );
  } finally {
    await tryCatch(fs.unlink(tempPath));
  }
}

/**
 * The item's best media that downloads. When one can never be had (a video
 * too big to keep, say), the next is tried — for a video that is its cover.
 * A passing failure (5xx, network) is not a reason to settle for less: the
 * whole item is tried again on the next sync.
 */
async function download(
  item: SubscriptionItem,
  referer: string,
): Promise<DownloadedFile> {
  const reasons: string[] = [];
  for (const media of item.media) {
    try {
      return await downloadOne(media, item.externalId, referer);
    } catch (error) {
      if (!(error instanceof PermanentSkip)) {
        throw error;
      }
      reasons.push(`${media.kind}: ${error.message}`);
    }
  }
  throw new PermanentSkip(reasons.join("; "));
}

/** Stores a downloaded file as an asset of the user, the way an upload is. */
async function storeAsset(userId: string, file: DownloadedFile) {
  let quotaApproved;
  try {
    quotaApproved = await QuotaService.checkStorageQuota(db, userId, file.size);
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      throw new StopRun("Storage quota reached");
    }
    throw error;
  }
  const assetId = newAssetId();
  await db.insert(assets).values({
    id: assetId,
    // Unattached until createBookmark takes it, same as an upload.
    assetType: AssetTypes.UNKNOWN,
    bookmarkId: null,
    userId,
    contentType: file.contentType,
    size: file.size,
    fileName: file.fileName,
  });
  try {
    await saveAssetFromFile({
      userId,
      assetId,
      assetPath: file.path,
      metadata: { contentType: file.contentType, fileName: file.fileName },
      quotaApproved,
    });
  } catch (error) {
    await tryCatch(db.delete(assets).where(eq(assets.id, assetId)));
    throw error;
  }
  return assetId;
}

async function discardAsset(userId: string, assetId: string) {
  await tryCatch(deleteAsset({ userId, assetId }));
  await tryCatch(db.delete(assets).where(eq(assets.id, assetId)));
}

/** A bookmark of this user that already holds this picture, if any. */
async function existingBookmarkFor(
  userId: string,
  item: SubscriptionItem,
): Promise<string | null> {
  const [row] = await db
    .select({ bookmarkId: listSubscriptionImportsTable.bookmarkId })
    .from(listSubscriptionImportsTable)
    .where(
      and(
        eq(listSubscriptionImportsTable.userId, userId),
        item.mediaKey
          ? eq(listSubscriptionImportsTable.mediaKey, item.mediaKey)
          : eq(listSubscriptionImportsTable.externalId, item.externalId),
        isNotNull(listSubscriptionImportsTable.bookmarkId),
      ),
    )
    .limit(1);
  return row?.bookmarkId ?? null;
}

async function remember(
  subscription: Subscription,
  item: SubscriptionItem,
  bookmarkId: string | null,
) {
  await db
    .insert(listSubscriptionImportsTable)
    .values({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      externalId: item.externalId,
      mediaKey: item.mediaKey,
      bookmarkId,
    })
    .onConflictDoNothing();
}

async function addToList(
  client: TRPCClient,
  subscription: Subscription,
  bookmarkId: string,
) {
  try {
    await client.lists.addToList({ listId: subscription.listId, bookmarkId });
  } catch (error) {
    throw new StopRun(`Couldn't add to the list: ${errorMessage(error)}`);
  }
}

async function importItem(
  subscription: Subscription,
  client: TRPCClient,
  item: SubscriptionItem,
  createdAt: Date,
): Promise<"downloaded" | "linked"> {
  // A picture the user already has: file that bookmark, don't make a copy.
  const existing = await existingBookmarkFor(subscription.userId, item);
  if (existing) {
    await addToList(client, subscription, existing);
    await remember(subscription, item, existing);
    return "linked";
  }

  const file = await download(item, SOURCES[subscription.kind].referer);
  let assetId: string;
  try {
    assetId = await storeAsset(subscription.userId, file);
  } finally {
    await tryCatch(fs.unlink(file.path));
  }

  let bookmarkId: string;
  try {
    const bookmark = await client.bookmarks.createBookmark({
      type: BookmarkTypes.ASSET,
      assetType: file.kind,
      assetId,
      fileName: file.fileName,
      sourceUrl: item.sourceUrl,
      title: item.title?.slice(0, MAX_BOOKMARK_TITLE_LENGTH),
      createdAt,
      source: "import",
    });
    bookmarkId = bookmark.id;
  } catch (error) {
    await discardAsset(subscription.userId, assetId);
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      throw new StopRun(error.message); // the bookmark quota
    }
    if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
      throw new PermanentSkip(error.message); // retrying won't change it
    }
    throw error;
  }

  try {
    await addToList(client, subscription, bookmarkId);
  } catch (error) {
    // Don't leave it behind unsorted.
    await tryCatch(client.bookmarks.deleteBookmark({ bookmarkId }));
    throw error;
  }
  await remember(subscription, item, bookmarkId);
  return "downloaded";
}

/** The user's Instagram session, opened — or why there's none to use. */
async function instagramSessionOf(
  userId: string,
): Promise<{ cookies: InstagramCookies } | { problem: string }> {
  const row = await db.query.instagramSessionsTable.findFirst({
    where: eq(instagramSessionsTable.userId, userId),
    columns: { session: true, status: true },
  });
  if (!row) {
    return {
      problem:
        "Instagram isn't connected. Paste your session in Settings → List subscriptions.",
    };
  }
  if (row.status !== "ok") {
    return {
      problem:
        "Your Instagram session has expired. Paste a fresh one in Settings → List subscriptions.",
    };
  }
  const opened = openSecret(row.session, INSTAGRAM_SESSION_PURPOSE);
  if (!opened) {
    // Sealed under another server secret (NEXTAUTH_SECRET changed).
    return {
      problem:
        "The saved Instagram session can't be read any more (the server's secret changed). Paste it again in Settings → List subscriptions.",
    };
  }
  return { cookies: JSON.parse(opened) as InstagramCookies };
}

async function run(
  job: DequeuedJob<ZSubscriptionRequestSchema>,
): Promise<SubscriptionRunResult> {
  const jobId = job.id;
  const subscription = await db.query.listSubscriptionsTable.findFirst({
    where: eq(listSubscriptionsTable.id, job.data.subscriptionId),
  });
  if (!subscription) {
    logger.info(
      `[subscription][${jobId}] Subscription ${job.data.subscriptionId} was removed; nothing to do.`,
    );
    return "skipped";
  }
  if (!subscription.enabled) {
    logger.info(
      `[subscription][${jobId}] Subscription ${subscription.id} is paused; skipping.`,
    );
    return "skipped";
  }

  const finish = async (
    fields: Partial<typeof listSubscriptionsTable.$inferInsert>,
  ) => {
    await db
      .update(listSubscriptionsTable)
      .set({ lastRunAt: new Date(), ...fields })
      .where(eq(listSubscriptionsTable.id, subscription.id));
  };
  const fail = async (message: string) => {
    logger.warn(`[subscription][${jobId}] ${message}`);
    await finish({ lastStatus: "failure", lastError: message.slice(0, 500) });
    return "failure" as const;
  };

  // The list must still take new bookmarks from this user (a shared list
  // can be taken away). A deleted list took its subscriptions with it.
  const { error: listError } = await tryCatch(
    (async () => {
      const ctx = await buildImpersonatingAuthedContext(subscription.userId);
      (await List.fromId(ctx, subscription.listId)).ensureCanEdit();
    })(),
  );
  if (listError) {
    return fail(`Can't add to this list anymore: ${errorMessage(listError)}`);
  }
  const quota = await QuotaService.canCreateBookmark(db, subscription.userId);
  if (!quota.result) {
    return fail(quota.error ?? "Bookmark quota reached");
  }

  logger.info(
    `[subscription][${jobId}] Syncing ${subscription.kind} "${subscription.name ?? subscription.url}" into list ${subscription.listId} ...`,
  );
  const handled = new Set(
    (
      await db
        .select({ externalId: listSubscriptionImportsTable.externalId })
        .from(listSubscriptionImportsTable)
        .where(eq(listSubscriptionImportsTable.subscriptionId, subscription.id))
    ).map((row) => row.externalId),
  );

  const signal = AbortSignal.any([
    job.abortSignal,
    AbortSignal.timeout(FETCH_TIMEOUT_MS[subscription.kind]),
  ]);
  let reading: Promise<SubscriptionFetchResult>;
  if (subscription.kind === "instagram") {
    const session = await instagramSessionOf(subscription.userId);
    if ("problem" in session) {
      return fail(session.problem);
    }
    reading = fetchInstagramCollection(subscription.url, session.cookies, {
      signal,
      isKnown: (externalId) => handled.has(externalId),
    });
  } else {
    reading = fetchPinterestBoard(subscription.url, { signal });
  }
  const { data: fetched, error: fetchError } = await tryCatch(reading);
  if (fetchError) {
    if (fetchError instanceof InstagramSessionError) {
      // Settings shows it, and no other collection tries it again.
      await db
        .update(instagramSessionsTable)
        .set({ status: "expired", checkedAt: new Date() })
        .where(eq(instagramSessionsTable.userId, subscription.userId));
      return fail(fetchError.message);
    }
    return fail(
      `Could not read ${subscription.url}: ${errorMessage(fetchError)}`,
    );
  }
  if (subscription.kind === "instagram") {
    await db
      .update(instagramSessionsTable)
      .set({ checkedAt: new Date() })
      .where(eq(instagramSessionsTable.userId, subscription.userId));
  }

  const fresh = fetched.items.filter((item) => !handled.has(item.externalId));
  // The board lists its newest pin first and so does the list, by when each
  // bookmark was made. Filing bottom-up keeps the board's order; taking the
  // oldest first means a board too big for one run fills in from the bottom,
  // each later run's pins landing above the earlier ones.
  const batch = fresh.slice(-MAX_NEW_PER_RUN[subscription.kind]).reverse();
  logger.info(
    `[subscription][${jobId}] ${fetched.items.length} items at the source${fetched.complete ? "" : " (paging stopped early)"}, ${fresh.length} new; taking ${batch.length}.`,
  );

  // Bookmarks sort by a timestamp kept to the second, and ties fall back to
  // the random id — several pictures filed in the same second would come out
  // shuffled. So each gets a second of its own, ending now, and all of them
  // after anything this subscription filed before (a run queued straight
  // after a big one may run a few seconds ahead of the clock for that).
  const [previous] = await db
    .select({ newest: max(bookmarks.createdAt) })
    .from(listSubscriptionImportsTable)
    .innerJoin(
      bookmarks,
      eq(bookmarks.id, listSubscriptionImportsTable.bookmarkId),
    )
    .where(eq(listSubscriptionImportsTable.subscriptionId, subscription.id));
  const firstSecond = Math.max(
    Math.floor(Date.now() / 1000) - (batch.length - 1),
    previous?.newest ? Math.floor(previous.newest.getTime() / 1000) + 1 : 0,
  );

  const client = await buildImpersonatingTRPCClient(subscription.userId);
  let downloaded = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;
  let failedInARow = 0;
  let stoppedBecause: string | null = null;

  for (const [index, item] of batch.entries()) {
    if (job.abortSignal.aborted) {
      stoppedBecause = "The sync ran out of time; the next one carries on.";
      break;
    }
    try {
      const outcome = await importItem(
        subscription,
        client,
        item,
        new Date((firstSecond + index) * 1000),
      );
      if (outcome === "downloaded") {
        downloaded++;
      } else {
        linked++;
      }
      failedInARow = 0;
    } catch (error) {
      if (error instanceof StopRun) {
        stoppedBecause = error.message;
        break;
      }
      if (error instanceof PermanentSkip) {
        await remember(subscription, item, null);
        skipped++;
        logger.info(
          `[subscription][${jobId}] Skipping ${item.sourceUrl} for good: ${error.message}`,
        );
        continue;
      }
      // Left out of the ledger on purpose: the next sync tries it again.
      failed++;
      failedInARow++;
      logger.warn(
        `[subscription][${jobId}] Failed on ${item.sourceUrl}, will retry next sync: ${errorMessage(error)}`,
      );
      if (failedInARow >= MAX_FAILURES_IN_A_ROW) {
        stoppedBecause = `${SOURCES[subscription.kind].name} isn't handing out the pictures (${errorMessage(error)}); trying again next sync.`;
        break;
      }
    }
  }

  const added = downloaded + linked;
  const lastError =
    stoppedBecause ??
    (failed > 0 && added === 0
      ? `${failed} couldn't be downloaded; the next sync tries again.`
      : null);
  await finish({
    name: fetched.name ?? subscription.name,
    lastStatus: lastError ? "failure" : "success",
    lastError,
    lastImportedCount: added,
  });
  logger.info(
    `[subscription][${jobId}] Added ${added} to list ${subscription.listId} (${downloaded} downloaded, ${linked} already saved)${skipped ? `, skipped ${skipped}` : ""}${failed ? `, ${failed} failed` : ""}${stoppedBecause ? `; stopped: ${stoppedBecause}` : ""}.`,
  );

  // More than one run's worth: carry straight on rather than waiting for the
  // schedule. Only while it is getting somewhere.
  if (!stoppedBecause && added > 0 && fresh.length > batch.length) {
    await SubscriptionQueue.enqueue(
      { subscriptionId: subscription.id },
      { groupId: subscription.userId },
    );
    await db
      .update(listSubscriptionsTable)
      .set({ lastStatus: "pending" })
      .where(eq(listSubscriptionsTable.id, subscription.id));
  }
  return lastError ? "failure" : "success";
}
