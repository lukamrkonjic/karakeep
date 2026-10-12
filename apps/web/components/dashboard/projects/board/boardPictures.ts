"use client";

import { useCallback } from "react";
import useUpload from "@/lib/hooks/upload-file";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useCreateBookmarkWithPostHook } from "@karakeep/shared-react/hooks/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getBookmarkLinkImageUrl } from "@karakeep/shared/utils/bookmarkUtils";

import { pictureOf } from "../../pictures/pictures";

/**
 * Fork: what a bookmark shows on a project's board (BoardItem) — and in the
 * board's Add pictures panel: a picture's own file, a video's first frame,
 * or a link's banner. Notes and links without one are cards of words.
 */
export function boardPictureOf(
  bookmark: ZBookmark,
): { src: string; video: boolean } | null {
  const own = pictureOf(bookmark);
  if (own) {
    return { src: getAssetUrl(own.assetId), video: own.video };
  }
  if (bookmark.content.type === BookmarkTypes.LINK) {
    const banner = getBookmarkLinkImageUrl(bookmark.content);
    if (banner) {
      return { src: banner.url, video: false };
    }
  }
  return null;
}

/**
 * The pictures' sizes seen so far (an <img> that loaded), by bookmark: a
 * picture dropped on the board takes its own shape at once.
 */
const seenSizes = new Map<string, { w: number; h: number }>();

export function rememberPictureSize(bookmarkId: string, img: HTMLImageElement) {
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    seenSizes.set(bookmarkId, { w: img.naturalWidth, h: img.naturalHeight });
  }
}

export function seenPictureSizes(bookmarkIds: string[]) {
  const out: Record<string, { w: number; h: number }> = {};
  for (const id of bookmarkIds) {
    const size = seenSizes.get(id);
    if (size) {
      out[id] = size;
    }
  }
  return out;
}

/** Files that can be pictures on a board. */
export function isBoardFile(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

/**
 * Saves a file dropped or pasted on the board as a bookmark (in no list, as
 * an upload on Home), and gives its id — then it goes on the board.
 */
export function useUploadForBoard() {
  const { mutateAsync: upload } = useUpload({});
  const { mutateAsync: createBookmark } = useCreateBookmarkWithPostHook();
  return useCallback(
    async (file: File) => {
      const uploaded = await upload(file);
      const bookmark = await createBookmark({
        ...uploaded,
        type: BookmarkTypes.ASSET,
        assetType: uploaded.contentType.startsWith("video/")
          ? "video"
          : "image",
        source: "web",
      });
      return bookmark.id;
    },
    [upload, createBookmark],
  );
}
