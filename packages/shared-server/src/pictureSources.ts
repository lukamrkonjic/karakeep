import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
  pictureEmbeddingsTable,
} from "@karakeep/db/schema";

import { CLIP_MODEL_ID } from "./pictureModels";

/**
 * Fork: a user's pictures as the picture model looks at them — every
 * picture bookmark by its own file, and every bookmark with a video (a
 * video bookmark, or a note or link carrying one) by the video's first
 * frame, once the preprocessing worker has made it. The fingerprints job
 * works through these and Settings → Pictures counts them: one definition,
 * so the two can't disagree.
 */

export interface PictureSource {
  bookmarkId: string;
  /** The file the model looks at: the picture, or a video's first frame. */
  assetId: string;
}

export async function pictureSources(
  db: DB,
  userId: string,
): Promise<PictureSource[]> {
  const frames = await db
    .select({ bookmarkId: assets.bookmarkId, assetId: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.userId, userId),
        eq(assets.assetType, AssetTypes.LINK_VIDEO_THUMBNAIL),
        isNotNull(assets.bookmarkId),
      ),
    );
  const images = await db
    .select({ bookmarkId: bookmarks.id, assetId: bookmarkAssets.assetId })
    .from(bookmarks)
    .innerJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
    .where(
      and(eq(bookmarks.userId, userId), eq(bookmarkAssets.assetType, "image")),
    );
  const byBookmark = new Map<string, string>();
  for (const frame of frames) {
    byBookmark.set(frame.bookmarkId!, frame.assetId);
  }
  for (const image of images) {
    byBookmark.set(image.bookmarkId, image.assetId);
  }
  return [...byBookmark].map(([bookmarkId, assetId]) => ({
    bookmarkId,
    assetId,
  }));
}

/**
 * The user's pictures and how far their fingerprints are: `todo` has none
 * of its current file (`again` when it had one of an earlier file or
 * model); `unreadable` were looked at but couldn't be read.
 */
export async function fingerprintProgress(db: DB, userId: string) {
  const sources = await pictureSources(db, userId);
  const made = new Map(
    (
      await db
        .select({
          bookmarkId: pictureEmbeddingsTable.bookmarkId,
          assetId: pictureEmbeddingsTable.assetId,
          model: pictureEmbeddingsTable.model,
          // Without loading the fingerprints themselves.
          read: sql<number>`${pictureEmbeddingsTable.embedding} is not null`,
        })
        .from(pictureEmbeddingsTable)
        .where(eq(pictureEmbeddingsTable.userId, userId))
    ).map((row) => [row.bookmarkId, row]),
  );
  const todo: (PictureSource & { again: boolean })[] = [];
  let done = 0;
  let unreadable = 0;
  for (const source of sources) {
    const row = made.get(source.bookmarkId);
    if (row && row.assetId === source.assetId && row.model === CLIP_MODEL_ID) {
      if (row.read) {
        done++;
      } else {
        unreadable++;
      }
    } else {
      todo.push({ ...source, again: !!row });
    }
  }
  return { total: sources.length, done, unreadable, todo };
}
