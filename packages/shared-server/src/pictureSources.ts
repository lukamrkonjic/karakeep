import { and, eq, isNotNull, like, or, sql } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
  pictureEmbeddingsTable,
  picturePalettesTable,
} from "@karakeep/db/schema";

import { CLIP_MODEL_ID } from "./pictureModels";

/**
 * Fork: a user's pictures as the picture model looks at them — every
 * picture bookmark by its own file, and every bookmark with a video (a
 * video bookmark, or a note or link carrying one) by the video's first
 * frame, once the preprocessing worker has made it. The fingerprints job
 * works through these and Settings → Pictures counts them: one definition,
 * so the two can't disagree. The colours (palettes) job goes by the same
 * files.
 */

export interface PictureSource {
  bookmarkId: string;
  /** The file the model looks at: the picture, or a video's first frame. */
  assetId: string;
  /** A video's own file, whose length is measured; null for a picture. */
  videoAssetId: string | null;
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
  const videos = new Map(
    (
      await db
        .select({ bookmarkId: assets.bookmarkId, assetId: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.userId, userId),
            isNotNull(assets.bookmarkId),
            or(
              eq(assets.assetType, AssetTypes.LINK_VIDEO),
              and(
                eq(assets.assetType, AssetTypes.BOOKMARK_ASSET),
                like(assets.contentType, "video/%"),
              ),
            ),
          ),
        )
    ).map((row) => [row.bookmarkId!, row.assetId]),
  );
  const images = await db
    .select({ bookmarkId: bookmarks.id, assetId: bookmarkAssets.assetId })
    .from(bookmarks)
    .innerJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
    .where(
      and(eq(bookmarks.userId, userId), eq(bookmarkAssets.assetType, "image")),
    );
  const byBookmark = new Map<string, PictureSource>();
  for (const frame of frames) {
    byBookmark.set(frame.bookmarkId!, {
      bookmarkId: frame.bookmarkId!,
      assetId: frame.assetId,
      videoAssetId: videos.get(frame.bookmarkId!) ?? null,
    });
  }
  for (const image of images) {
    byBookmark.set(image.bookmarkId, { ...image, videoAssetId: null });
  }
  return [...byBookmark.values()];
}

/**
 * The user's pictures and how far their fingerprints are: `todo` has none
 * of its current file (`again` when it had one of an earlier file or
 * model), or is a video whose length isn't known yet (`lengthOnly`: its
 * fingerprint is fine); `unreadable` were looked at but couldn't be read.
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
          duration: pictureEmbeddingsTable.duration,
          // Without loading the fingerprints themselves.
          read: sql<number>`${pictureEmbeddingsTable.embedding} is not null`,
        })
        .from(pictureEmbeddingsTable)
        .where(eq(pictureEmbeddingsTable.userId, userId))
    ).map((row) => [row.bookmarkId, row]),
  );
  const todo: (PictureSource & { again: boolean; lengthOnly: boolean })[] = [];
  let done = 0;
  let unreadable = 0;
  for (const source of sources) {
    const row = made.get(source.bookmarkId);
    if (row && row.assetId === source.assetId && row.model === CLIP_MODEL_ID) {
      if (!row.read) {
        unreadable++;
      } else if (source.videoAssetId && row.duration === null) {
        todo.push({ ...source, again: false, lengthOnly: true });
      } else {
        done++;
      }
    } else {
      todo.push({ ...source, again: !!row, lengthOnly: false });
    }
  }
  return { total: sources.length, done, unreadable, todo };
}

/**
 * The same for the pictures' colours: `todo` has none of its current file;
 * `unreadable` were looked at but couldn't be read.
 */
export async function paletteProgress(db: DB, userId: string) {
  const sources = await pictureSources(db, userId);
  const made = new Map(
    (
      await db
        .select({
          bookmarkId: picturePalettesTable.bookmarkId,
          assetId: picturePalettesTable.assetId,
          read: sql<number>`${picturePalettesTable.colours} is not null`,
        })
        .from(picturePalettesTable)
        .where(eq(picturePalettesTable.userId, userId))
    ).map((row) => [row.bookmarkId, row]),
  );
  const todo: PictureSource[] = [];
  let done = 0;
  let unreadable = 0;
  for (const source of sources) {
    const row = made.get(source.bookmarkId);
    if (row && row.assetId === source.assetId) {
      if (row.read) {
        done++;
      } else {
        unreadable++;
      }
    } else {
      todo.push(source);
    }
  }
  return { total: sources.length, done, unreadable, todo };
}

/** The user's bookmarks that are videos (by pictureSources' definition). */
export async function videoBookmarkIds(
  db: DB,
  userId: string,
): Promise<Set<string>> {
  return new Set(
    (await pictureSources(db, userId))
      .filter((source) => source.videoAssetId)
      .map((source) => source.bookmarkId),
  );
}
