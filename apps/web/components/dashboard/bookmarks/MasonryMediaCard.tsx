"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { imageLoadGate } from "@/lib/assetLoadGate";
import { useNearViewportLoadSlot } from "@/lib/hooks/useNearViewportLoadSlot";
import { cn } from "@/lib/utils";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import BookmarkActionBar from "./BookmarkActionBar";
import { MultiBookmarkSelector } from "./BookmarkLayoutAdaptingCard";
import { BookmarkVideo } from "./BookmarkVideo";

/**
 * Renders the actual <Image> only once granted a load slot (see
 * assetLoadGate.ts) — karakeep doesn't store image dimensions, so every tile
 * starts at width=0/height=0 and only gets its real size once bytes start
 * arriving; letting dozens of tiles all request at once on mount/fast-scroll
 * can overwhelm a modest self-hosted server's connection pool and leave some
 * stuck indefinitely. A placeholder box holds the tile's place in the
 * masonry column until its turn comes.
 */
function GatedImage({
  assetId,
  alt,
  className,
}: {
  assetId: string;
  alt: string;
  className?: string;
}) {
  const { containerRef, granted, release } = useNearViewportLoadSlot(
    imageLoadGate,
    { rootMargin: "600px" },
  );

  // Safety net: don't hold the slot forever if load/error never fires.
  useEffect(() => {
    if (!granted) return;
    const timer = window.setTimeout(release, 15000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted]);

  if (!granted) {
    return (
      <div
        ref={containerRef}
        className={cn("aspect-[3/4] w-full animate-pulse bg-muted", className)}
      />
    );
  }

  return (
    <Image
      alt={alt}
      src={getAssetUrl(assetId)}
      width={0}
      height={0}
      sizes="100vw"
      unoptimized
      className={cn("block h-auto w-full", className)}
      onLoad={release}
      onError={release}
    />
  );
}

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

      {/* Dim the whole image/video on hover (not just a top gradient) so the
          title and action icons stay readable no matter the media's own
          colors — same idea as Pinterest's hover state. */}
      <div className="transition-[filter] duration-200 group-hover:brightness-[0.6]">
        {media.type === "image" ? (
          <Link href={`/dashboard/preview/${bookmark.id}`} className="block">
            <GatedImage assetId={media.assetId} alt={title ?? "bookmark"} />
          </Link>
        ) : (
          <BookmarkVideo assetId={media.assetId} thumbnail className="w-full" />
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
