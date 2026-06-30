"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import BookmarkActionBar from "./BookmarkActionBar";
import { MultiBookmarkSelector } from "./BookmarkLayoutAdaptingCard";
import { BookmarkVideo } from "./BookmarkVideo";

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
  media: { type: "image" | "video"; assetId: string };
  className?: string;
  bookmarkIndex?: number;
}) {
  const title = getBookmarkTitle(bookmark);

  return (
    <div
      className={cn("group relative overflow-hidden rounded-lg", className)}
      data-bookmark-index={bookmarkIndex}
    >
      <MultiBookmarkSelector bookmark={bookmark} />

      {media.type === "image" ? (
        <Link href={`/dashboard/preview/${bookmark.id}`} className="block">
          <Image
            alt={title ?? "bookmark"}
            src={getAssetUrl(media.assetId)}
            width={0}
            height={0}
            sizes="100vw"
            unoptimized
            className="block h-auto w-full"
          />
        </Link>
      ) : (
        <BookmarkVideo assetId={media.assetId} thumbnail className="w-full" />
      )}

      {/* Title + actions, revealed on hover at the top so they don't collide
          with a video's native controls along the bottom. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        {title && (
          <span className="pointer-events-auto line-clamp-2 text-sm font-medium text-white drop-shadow">
            {title}
          </span>
        )}
        <div className="pointer-events-auto ml-auto shrink-0 text-white">
          <BookmarkActionBar bookmark={bookmark} />
        </div>
      </div>
    </div>
  );
}
