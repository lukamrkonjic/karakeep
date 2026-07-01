"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { GatedImage } from "./GatedImage";

/**
 * Inline HTML5 player for video attachments (assetType === "video").
 *
 * Kept as a standalone component to minimise the upstream-merge surface: the
 * card/preview files only need a one-line call to render a video.
 *
 * - In the feed (`thumbnail`), the player is click-to-load: many uploaded
 *   videos (screen/meeting recordings especially) aren't "faststart"
 *   optimized, so even `preload="metadata"` can force the browser to read
 *   deep into the file to find a trailing moov atom — auto-doing that for
 *   every tile scrolling into view is what made the feed feel slow. Instead
 *   we show a static placeholder and only mount the real <video> (which then
 *   autoplays) once the user explicitly clicks it.
 * - `thumbnailAssetId` (see assetPreprocessingWorker's extracted poster
 *   frame) is shown as the placeholder when available, at the video's own
 *   aspect ratio — same as any other image tile — instead of a flat black
 *   box; falls back to the black box for videos without one yet (older
 *   attachments, or extraction failed).
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
}: {
  assetId: string;
  /** Generated poster-frame image, at the video's own aspect ratio. */
  thumbnailAssetId?: string;
  className?: string;
  /** Feed mode: click-to-load placeholder instead of mounting immediately. */
  thumbnail?: boolean;
}) {
  const [clicked, setClicked] = useState(false);
  const showPlayer = !thumbnail || clicked;

  if (!showPlayer) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setClicked(true);
        }}
        className={cn("relative block w-full", className)}
      >
        {thumbnailAssetId ? (
          <GatedImage assetId={thumbnailAssetId} alt="Video preview" />
        ) : (
          // aspect-video gives the placeholder a size before load; it's
          // inert when the caller already constrains height.
          <div className="aspect-video w-full bg-black" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white/90 transition-colors hover:bg-black/30 hover:text-white">
          <Play className="size-10" />
        </div>
      </button>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- captions not available for user-uploaded videos
    <video
      src={getAssetUrl(assetId)}
      className={cn("bg-black", className)}
      controls
      autoPlay={thumbnail}
      preload="metadata"
      playsInline
      // Don't let a click on the player bubble up to the card's navigation.
      onClick={(e) => e.stopPropagation()}
    >
      Not supported by your browser
    </video>
  );
}
