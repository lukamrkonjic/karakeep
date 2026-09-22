"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { GatedImage } from "./GatedImage";

/**
 * Video attachments (assetType === "video").
 *
 * Kept as a standalone component to minimise the upstream-merge surface: the
 * card/preview files only need a one-line call to render a video.
 *
 * - In the feed (`thumbnail`) a video never plays. The tile is its poster and
 *   a click opens the bookmark's preview modal, where it plays (`autoPlay`);
 *   the play mark only shows on hover. No <video> is mounted per tile either:
 *   many uploads (screen/meeting recordings especially) aren't "faststart",
 *   so even `preload="metadata"` reads deep into the file for a trailing moov
 *   atom, and doing that for every tile scrolling into view made the feed
 *   slow.
 * - `thumbnailAssetId` (see assetPreprocessingWorker's extracted poster
 *   frame) is the tile's picture, at the video's own aspect ratio like any
 *   other image tile, and the player's `poster`, which gives it that shape
 *   before the first frame arrives. Videos without one yet (older
 *   attachments, or extraction failed) fall back to a black 16:9 box.
 * - The asset endpoint (packages/api/utils/assets.ts) already serves HTTP range
 *   requests, so native seeking/scrubbing works out of the box once playing.
 * - Plays mp4 and webm in all browsers; mkv (video/x-matroska) depends on the
 *   browser's codec support and may not preview.
 */
export function BookmarkVideo({
  assetId,
  thumbnailAssetId,
  className,
  thumbnail = false,
  bookmarkId,
  autoPlay = false,
}: {
  assetId: string;
  /** Generated poster-frame image, at the video's own aspect ratio. */
  thumbnailAssetId?: string;
  className?: string;
  /** Feed mode: the poster, linking to the preview, instead of a player. */
  thumbnail?: boolean;
  /** The bookmark whose preview a feed tile opens. */
  bookmarkId?: string;
  /** Start playing on mount — the preview modal, opened by clicking a tile. */
  autoPlay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    // Only the copy that is on screen. The preview renders its wide and
    // narrow layouts side by side and hides one with CSS, and a hidden
    // <video autoplay> still plays, so the sound would come out twice.
    if (autoPlay && video && video.getClientRects().length > 0) {
      void video.play().catch(() => undefined);
    }
  }, [autoPlay]);

  if (thumbnail) {
    const poster = (
      <>
        {thumbnailAssetId ? (
          <GatedImage assetId={thumbnailAssetId} alt="Video preview" />
        ) : (
          // aspect-video gives the placeholder a size before load; it's
          // inert when the caller already constrains height.
          <div className="aspect-video w-full bg-black" />
        )}
        <div className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity duration-200 group-hover/video:opacity-100">
          <span className="flex size-14 items-center justify-center rounded-full bg-black/50">
            <Play className="ml-1 size-6 fill-current" />
          </span>
        </div>
      </>
    );
    const frame = cn("group/video relative block w-full", className);
    return bookmarkId ? (
      <Link
        href={`/dashboard/preview/${bookmarkId}`}
        className={frame}
        draggable={false}
        aria-label="Play video"
      >
        {poster}
      </Link>
    ) : (
      <div className={frame}>{poster}</div>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- captions not available for user-uploaded videos
    <video
      ref={videoRef}
      src={getAssetUrl(assetId)}
      poster={thumbnailAssetId ? getAssetUrl(thumbnailAssetId) : undefined}
      className={cn("bg-black", className)}
      controls
      preload="metadata"
      playsInline
      // Don't let a click on the player bubble up to the card's navigation.
      onClick={(e) => e.stopPropagation()}
    >
      Not supported by your browser
    </video>
  );
}
