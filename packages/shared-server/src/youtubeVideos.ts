import { eq } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import { bookmarkLinks, bookmarks } from "@karakeep/db/schema";
import type { EnqueueOptions } from "@karakeep/shared/queueing";
import type { ZBookmarkSource } from "@karakeep/shared/types/bookmarks";
import { youTubeVideoId } from "@karakeep/shared/utils/youtube";

import { VideoWorkerQueue } from "./queues";

/** What arrives in bulk keeps its links: a feed or an import never downloads every video in it. */
const BULK_SOURCES: ReadonlySet<ZBookmarkSource> = new Set(["rss", "import"]);

/**
 * Fork: a YouTube video added as a link is downloaded in the background and
 * becomes a video bookmark, the same bookmark (apps/workers/workers/
 * youtubeVideo.ts). This marks the link as downloading and queues it, once
 * however often it's asked; false when the bookmark isn't a YouTube video's
 * link (any more) or came in bulk. `explicit`: the user just added it
 * themselves, so where it first came from doesn't matter.
 */
export async function queueYouTubeVideoDownload(
  db: DB,
  bookmarkId: string,
  opts?: Omit<EnqueueOptions, "idempotencyKey"> & { explicit?: boolean },
): Promise<boolean> {
  const link = await db
    .select({ url: bookmarkLinks.url, source: bookmarks.source })
    .from(bookmarkLinks)
    .innerJoin(bookmarks, eq(bookmarks.id, bookmarkLinks.id))
    .where(eq(bookmarkLinks.id, bookmarkId))
    .get();
  if (
    !link ||
    !youTubeVideoId(link.url) ||
    (!opts?.explicit && link.source && BULK_SOURCES.has(link.source))
  ) {
    return false;
  }
  await db
    .update(bookmarkLinks)
    .set({ videoDownloadStatus: "pending" })
    .where(eq(bookmarkLinks.id, bookmarkId));
  const { explicit: _explicit, ...enqueueOpts } = opts ?? {};
  await VideoWorkerQueue.enqueue(
    { bookmarkId, url: link.url },
    { ...enqueueOpts, idempotencyKey: `youtube:${bookmarkId}` },
  );
  return true;
}
