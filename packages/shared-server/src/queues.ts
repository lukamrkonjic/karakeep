import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import type { DB } from "@karakeep/db";
import {
  listSubscriptionsTable,
  pictureDuplicateScansTable,
  pictureJobRunsTable,
} from "@karakeep/db/schema";
import {
  EnqueueOptions,
  getQueueClient,
  Queue,
  QueueClient,
  QueueOptions,
} from "@karakeep/shared/queueing";
import { zRuleEngineEventSchema } from "@karakeep/shared/types/rules";

import { loadAllPlugins } from "./plugins";

export enum QueuePriority {
  Low = 50,
  Default = 0,
}

// Lazy client initialization - plugins are loaded on first access
// We cache the promise to ensure only one initialization happens even with concurrent calls
let clientPromise: Promise<QueueClient> | null = null;

function getClient(): Promise<QueueClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      await loadAllPlugins();
      return await getQueueClient();
    })();
  }
  return clientPromise;
}

/**
 * Creates a deferred queue that initializes lazily on first use.
 * This allows the module to be imported without requiring plugins to be loaded.
 */
function createDeferredQueue<T>(name: string, options: QueueOptions): Queue<T> {
  // Cache the promise to ensure only one queue is created even with concurrent calls
  let queuePromise: Promise<Queue<T>> | null = null;

  const ensureQueue = (): Promise<Queue<T>> => {
    if (!queuePromise) {
      queuePromise = (async () => {
        const client = await getClient();
        return client.createQueue<T>(name, options);
      })();
    }
    return queuePromise;
  };

  return {
    opts: options,
    name: () => name,
    ensureInit: async () => {
      await ensureQueue();
    },
    async enqueue(payload: T, opts?: EnqueueOptions) {
      return (await ensureQueue()).enqueue(payload, opts);
    },
    async stats() {
      return (await ensureQueue()).stats();
    },
    async cancelAllNonRunning() {
      const q = await ensureQueue();
      return q.cancelAllNonRunning?.() ?? 0;
    },
  };
}

export async function prepareQueue() {
  const client = await getClient();
  await client.prepare();
}

export async function startQueue() {
  const client = await getClient();
  await client.start();
}

// Link Crawler
export const zCrawlLinkRequestSchema = z.object({
  bookmarkId: z.string(),
  runInference: z.boolean().optional(),
  archiveFullPage: z.boolean().optional().default(false),
  storePdf: z.boolean().optional().default(false),
});
export type ZCrawlLinkRequest = z.input<typeof zCrawlLinkRequestSchema>;

export const LinkCrawlerQueue = createDeferredQueue<ZCrawlLinkRequest>(
  "link_crawler_queue",
  {
    defaultJobArgs: {
      numRetries: 5,
    },
    keepFailedJobs: false,
  },
);

// Separate queue for low priority link crawling (e.g. imports)
// This prevents low priority crawling from impacting the parallelism of the main queue
export const LowPriorityCrawlerQueue = createDeferredQueue<ZCrawlLinkRequest>(
  "low_priority_crawler_queue",
  {
    defaultJobArgs: {
      numRetries: 5,
    },
    keepFailedJobs: false,
  },
);

// Builds a stable, payload-derived idempotency key for crawler queue jobs.
// Keys sort before serialization so `{a, b}` and `{b, a}` produce the same
// key, and differing flags (archiveFullPage, runInference, storePdf) yield
// distinct keys so non-equivalent crawls are not deduped together.
export function buildCrawlIdempotencyKey(payload: ZCrawlLinkRequest): string {
  return `crawl:${JSON.stringify(payload, Object.keys(payload).sort())}`;
}

// Inference Worker
export const zOpenAIRequestSchema = z.object({
  bookmarkId: z.string(),
  type: z.enum(["summarize", "tag"]).default("tag"),
  // Precomputed embedding so tagging can find similar bookmarks via
  // search({vector}) without waiting for the vector to be indexed. Only set on
  // the embed -> tag path.
  embedding: z.array(z.number()).optional(),
});
export type ZOpenAIRequest = z.infer<typeof zOpenAIRequestSchema>;

export const OpenAIQueue = createDeferredQueue<ZOpenAIRequest>("openai_queue", {
  defaultJobArgs: {
    numRetries: 3,
  },
  keepFailedJobs: false,
});

// Embeddings Worker
//
// - "embed": entry point. Generates the bookmark embedding, then dispatches the
//   tagging job (carrying the vector) and an "index" job. Does NOT persist the
//   vector itself, so it never retries on indexing failures.
// - "index": persists a precomputed vector in the vector store. Its retries (the
//   slow Meilisearch index build) are isolated and never re-trigger tagging.
// - "delete": removes the vector from the store.
export const zEmbeddingsRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("embed"),
    bookmarkId: z.string(),
    force: z.boolean().optional(),
    runTaggingOnComplete: z.boolean().optional().default(true),
  }),
  z.object({
    type: z.literal("index"),
    bookmarkId: z.string(),
    userId: z.string(),
    embedding: z.array(z.number()),
  }),
  z.object({
    type: z.literal("delete"),
    bookmarkId: z.string(),
  }),
]);
export type ZEmbeddingsRequest = z.infer<typeof zEmbeddingsRequestSchema>;

export const EmbeddingsQueue = createDeferredQueue<ZEmbeddingsRequest>(
  "embeddings_queue",
  {
    defaultJobArgs: {
      numRetries: 3,
    },
    keepFailedJobs: false,
  },
);

// Search Indexing Worker
export const zSearchIndexingRequestSchema = z.object({
  bookmarkId: z.string(),
  type: z.enum(["index", "delete"]),
});
export type ZSearchIndexingRequest = z.infer<
  typeof zSearchIndexingRequestSchema
>;
export const SearchIndexingQueue = createDeferredQueue<ZSearchIndexingRequest>(
  "searching_indexing",
  {
    defaultJobArgs: {
      numRetries: 5,
    },
    keepFailedJobs: false,
  },
);

// Admin maintenance worker
export const zTidyAssetsRequestSchema = z.object({
  cleanDanglingAssets: z.boolean().optional().default(false),
  syncAssetMetadata: z.boolean().optional().default(false),
});
export type ZTidyAssetsRequest = z.infer<typeof zTidyAssetsRequestSchema>;

export const zAdminMaintenanceTaskSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tidy_assets"),
    args: zTidyAssetsRequestSchema,
  }),
  z.object({
    type: z.literal("migrate_large_link_html"),
  }),
]);

export type ZAdminMaintenanceTask = z.infer<typeof zAdminMaintenanceTaskSchema>;
export type ZAdminMaintenanceTaskType = ZAdminMaintenanceTask["type"];
export type ZAdminMaintenanceTidyAssetsTask = Extract<
  ZAdminMaintenanceTask,
  { type: "tidy_assets" }
>;
export type ZAdminMaintenanceMigrateLargeLinkHtmlTask = Extract<
  ZAdminMaintenanceTask,
  { type: "migrate_large_link_html" }
>;

export const AdminMaintenanceQueue = createDeferredQueue<ZAdminMaintenanceTask>(
  "admin_maintenance_queue",
  {
    defaultJobArgs: {
      numRetries: 1,
    },
    keepFailedJobs: false,
  },
);

export async function triggerSearchReindex(
  bookmarkId: string,
  opts?: Omit<EnqueueOptions, "idempotencyKey">,
) {
  await SearchIndexingQueue.enqueue(
    {
      bookmarkId,
      type: "index",
    },
    {
      ...opts,
      idempotencyKey: `index:${bookmarkId}`,
    },
  );
}

export const zvideoRequestSchema = z.object({
  bookmarkId: z.string(),
  url: z.string(),
});
export type ZVideoRequest = z.infer<typeof zvideoRequestSchema>;

export const VideoWorkerQueue = createDeferredQueue<ZVideoRequest>(
  "video_queue",
  {
    defaultJobArgs: {
      numRetries: 5,
    },
    keepFailedJobs: false,
  },
);

// Feed Worker
export const zFeedRequestSchema = z.object({
  feedId: z.string(),
});
export type ZFeedRequestSchema = z.infer<typeof zFeedRequestSchema>;

export const FeedQueue = createDeferredQueue<ZFeedRequestSchema>("feed_queue", {
  defaultJobArgs: {
    // One retry is enough for the feed queue given that it's periodic
    numRetries: 1,
  },
  keepFailedJobs: false,
});

// Fork: list subscriptions (a public Pinterest board synced into a list)
export const zSubscriptionRequestSchema = z.object({
  subscriptionId: z.string(),
});
export type ZSubscriptionRequestSchema = z.infer<
  typeof zSubscriptionRequestSchema
>;

export const SubscriptionQueue =
  createDeferredQueue<ZSubscriptionRequestSchema>("subscription_queue", {
    defaultJobArgs: {
      // Periodic, like the feed queue: one retry, then wait for the next run.
      numRetries: 1,
    },
    keepFailedJobs: false,
  });

/**
 * Asks for a sync of one subscription and shows it as syncing ("pending")
 * until the worker is done. A sync that is already queued or running absorbs
 * the request, so pressing "Sync now" twice runs it once.
 */
export async function queueSubscriptionSync(
  db: DB,
  subscription: { id: string; userId: string },
) {
  await db
    .update(listSubscriptionsTable)
    .set({ lastStatus: "pending" })
    .where(eq(listSubscriptionsTable.id, subscription.id));
  await SubscriptionQueue.enqueue(
    { subscriptionId: subscription.id },
    {
      idempotencyKey: `subscription:${subscription.id}`,
      groupId: subscription.userId,
    },
  );
}

// Preprocess Assets
export const zAssetPreprocessingRequestSchema = z.object({
  bookmarkId: z.string(),
  fixMode: z.boolean().optional().default(false),
  // When set, this specific asset attachment is processed (currently only
  // used for video -> thumbnail generation) instead of the bookmark's
  // primary asset (image/pdf uploads).
  assetId: z.string().optional(),
});
export type AssetPreprocessingRequest = z.infer<
  typeof zAssetPreprocessingRequestSchema
>;
export const AssetPreprocessingQueue =
  createDeferredQueue<AssetPreprocessingRequest>("asset_preprocessing_queue", {
    defaultJobArgs: {
      numRetries: 2,
    },
    keepFailedJobs: false,
  });

// Webhook worker
export const zWebhookRequestSchema = z.object({
  bookmarkId: z.string(),
  operation: z.enum(["crawled", "created", "edited", "ai tagged", "deleted"]),
  userId: z.string().optional(),
});
export type ZWebhookRequest = z.infer<typeof zWebhookRequestSchema>;
export const WebhookQueue = createDeferredQueue<ZWebhookRequest>(
  "webhook_queue",
  {
    defaultJobArgs: {
      numRetries: 3,
    },
    keepFailedJobs: false,
  },
);

// RuleEngine worker
export const zRuleEngineRequestSchema = z.object({
  bookmarkId: z.string(),
  events: z.array(zRuleEngineEventSchema),
});
export type ZRuleEngineRequest = z.infer<typeof zRuleEngineRequestSchema>;
export const RuleEngineQueue = createDeferredQueue<ZRuleEngineRequest>(
  "rule_engine_queue",
  {
    defaultJobArgs: {
      numRetries: 1,
    },
    keepFailedJobs: false,
  },
);

// Backup worker
export const zBackupRequestSchema = z.object({
  userId: z.string(),
  backupId: z.string().optional(),
});
export type ZBackupRequest = z.infer<typeof zBackupRequestSchema>;
export const BackupQueue = createDeferredQueue<ZBackupRequest>("backup_queue", {
  defaultJobArgs: {
    numRetries: 2,
  },
  keepFailedJobs: false,
});

// Fork: the picture jobs (Settings → Pictures), each its own queue and
// worker. The fingerprints job gives new pictures their fingerprint; the
// duplicate-pictures check and list suggestions work on those, so asking for
// either marks it "waiting" and asks for fingerprints — whose job, when it's
// done, queues whatever waits (apps/workers/workers/pictures/).
export const zPictureJobRequestSchema = z.object({
  userId: z.string(),
});
export type ZPictureJobRequest = z.infer<typeof zPictureJobRequestSchema>;

export const PictureFingerprintsQueue = createDeferredQueue<ZPictureJobRequest>(
  "picture_fingerprints_queue",
  {
    defaultJobArgs: {
      // One cut short carries on at the next run.
      numRetries: 1,
    },
    keepFailedJobs: false,
  },
);

export const PictureSuggestionsQueue = createDeferredQueue<ZPictureJobRequest>(
  "picture_suggestions_queue",
  {
    defaultJobArgs: { numRetries: 1 },
    keepFailedJobs: false,
  },
);

// Fork: search by description — one description for the text half of the
// picture model (a row of pictureTextQueries to fill in).
export const zPictureTextRequestSchema = z.object({
  queryId: z.string(),
});
export type ZPictureTextRequest = z.infer<typeof zPictureTextRequestSchema>;

export const PictureTextQueue = createDeferredQueue<ZPictureTextRequest>(
  "picture_text_queue",
  {
    // Someone is waiting for it: asking again is the retry.
    defaultJobArgs: { numRetries: 0 },
    keepFailedJobs: false,
  },
);

/** Marks a picture job pending or waiting, unless it's running now. */
async function markPictureJob(
  db: DB,
  userId: string,
  job: "fingerprints" | "suggestions",
  status: "waiting" | "pending",
) {
  await db
    .insert(pictureJobRunsTable)
    .values({ userId, job, status })
    .onConflictDoUpdate({
      target: [pictureJobRunsTable.userId, pictureJobRunsTable.job],
      set: { status, error: null },
      setWhere: ne(pictureJobRunsTable.status, "running"),
    });
}

/**
 * Fingerprints for the user's pictures that have none, now. A run already
 * queued or running absorbs this one.
 */
export async function requestPictureFingerprints(db: DB, userId: string) {
  await markPictureJob(db, userId, "fingerprints", "pending");
  await PictureFingerprintsQueue.enqueue(
    { userId },
    { idempotencyKey: `picture-fingerprints:${userId}`, groupId: userId },
  );
}

/** List suggestions for the new pictures, once they have fingerprints. */
export async function requestListSuggestions(db: DB, userId: string) {
  await markPictureJob(db, userId, "suggestions", "waiting");
  await requestPictureFingerprints(db, userId);
}

/** Queues list suggestions themselves (the fingerprints job, when done). */
export async function queueListSuggestions(db: DB, userId: string) {
  await markPictureJob(db, userId, "suggestions", "pending");
  await PictureSuggestionsQueue.enqueue(
    { userId },
    { idempotencyKey: `picture-suggestions:${userId}`, groupId: userId },
  );
}

// Fork: duplicate pictures — one check of one user's pictures (the nightly
// run, or Cleanups → Duplicate pictures → Check now).
export const zDuplicatePicturesRequestSchema = z.object({
  userId: z.string(),
});
export type ZDuplicatePicturesRequest = z.infer<
  typeof zDuplicatePicturesRequestSchema
>;

export const DuplicatePicturesQueue =
  createDeferredQueue<ZDuplicatePicturesRequest>("duplicate_pictures_queue", {
    defaultJobArgs: {
      // It runs every night anyway.
      numRetries: 0,
    },
    keepFailedJobs: false,
  });

/**
 * Asks for a check of the user's pictures: it waits for their fingerprints
 * to be made first. A check already running absorbs this one.
 */
export async function queueDuplicatePicturesCheck(db: DB, userId: string) {
  await db
    .insert(pictureDuplicateScansTable)
    .values({ userId, status: "waiting" })
    .onConflictDoUpdate({
      target: pictureDuplicateScansTable.userId,
      set: { status: "waiting", error: null },
      setWhere: ne(pictureDuplicateScansTable.status, "running"),
    });
  await requestPictureFingerprints(db, userId);
}

/** Queues a waiting check itself (the fingerprints job, when done). */
export async function queueDuplicatePicturesCompare(db: DB, userId: string) {
  await db
    .update(pictureDuplicateScansTable)
    .set({ status: "pending" })
    .where(
      and(
        eq(pictureDuplicateScansTable.userId, userId),
        eq(pictureDuplicateScansTable.status, "waiting"),
      ),
    );
  await DuplicatePicturesQueue.enqueue(
    { userId },
    { idempotencyKey: `duplicate-pictures:${userId}`, groupId: userId },
  );
}
