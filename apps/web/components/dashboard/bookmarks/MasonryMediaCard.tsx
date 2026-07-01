"use client";

import Link from "next/link";
import useBulkActionsStore from "@/lib/bulkActions";
import { useBookmarkDragStart } from "@/lib/hooks/useBookmarkDragStart";
import { cn } from "@/lib/utils";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import BookmarkActionBar from "./BookmarkActionBar";
import { MultiBookmarkSelector } from "./BookmarkLayoutAdaptingCard";
import { BookmarkVideo } from "./BookmarkVideo";
import { GatedImage } from "./GatedImage";

/**
 * Eagle.cool-style masonry tile: shows ONLY the media (image/video) at its
 * natural aspect ratio, with the title and actions (expand / more) revealed as
 * a hover overlay instead of a separate card body below the media.
 *
 * Used only in the masonry layout for media bookmarks (see TextCard /
 * AssetCard); every other layout keeps the standard card. Kept in its own file
 * to minimise the upstream-merge surface.
 */
export function MasonryMediaCard({
  bookmark,
  media,
  className,
  bookmarkIndex,
}: {
  bookmark: ZBookmark;
  media: {
    type: "image" | "video";
    assetId: string;
    /** Generated poster-frame image for video media, if one exists yet. */
    thumbnailAssetId?: string;
  };
  className?: string;
  bookmarkIndex?: number;
}) {
  const title = getBookmarkTitle(bookmark);
  const { isBulkEditEnabled } = useBulkActionsStore();
  const handleDragStart = useBookmarkDragStart(bookmark);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg",
        !isBulkEditEnabled && "cursor-grab active:cursor-grabbing",
        className,
      )}
      data-bookmark-index={bookmarkIndex}
      // The whole tile is the drag handle — there's no room for a separate
      // grip icon on a borderless media-only tile. Drag it onto a sidebar
      // list to add it there (see AllLists.tsx's useDropTarget).
      draggable={!isBulkEditEnabled}
      onDragStart={isBulkEditEnabled ? undefined : handleDragStart}
    >
      <MultiBookmarkSelector bookmark={bookmark} />

      {/* Dim the whole image/video on hover (not just a top gradient) so the
          title and action icons stay readable no matter the media's own
          colors — same idea as Pinterest's hover state. */}
      <div className="transition-[filter] duration-200 group-hover:brightness-[0.6]">
        {media.type === "image" ? (
          <Link
            href={`/dashboard/preview/${bookmark.id}`}
            className="block"
            draggable={false}
          >
            <GatedImage assetId={media.assetId} alt={title ?? "bookmark"} />
          </Link>
        ) : (
          <BookmarkVideo
            assetId={media.assetId}
            thumbnailAssetId={media.thumbnailAssetId}
            thumbnail
            className="w-full"
          />
        )}
      </div>

      {/* Title + actions, revealed on hover at the top so they don't collide
          with a video's native controls along the bottom. Icons are forced
          white since they always sit on the dimmed media above. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        {title && (
          <span className="pointer-events-auto line-clamp-2 text-sm font-medium text-white drop-shadow">
            {title}
          </span>
        )}
        <div className="pointer-events-auto ml-auto shrink-0">
          <BookmarkActionBar bookmark={bookmark} className="text-white" />
        </div>
      </div>
    </div>
  );
}
