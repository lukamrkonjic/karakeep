"use client";

import { cn } from "@/lib/utils";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

/**
 * Inline HTML5 player for video attachments (assetType === "video").
 *
 * Kept as a standalone component to minimise the upstream-merge surface: the
 * card/preview files only need a one-line call to render a video.
 *
 * - `preload="metadata"` means the feed only fetches each video's header + first
 *   frame (not the whole file) until the user hits play, so a grid of videos
 *   stays cheap.
 * - The asset endpoint (packages/api/utils/assets.ts) already serves HTTP range
 *   requests, so native seeking/scrubbing works out of the box.
 * - Plays mp4 and webm in all browsers; mkv (video/x-matroska) depends on the
 *   browser's codec support and may not preview.
 */
export function BookmarkVideo({
  assetId,
  className,
  thumbnail = false,
}: {
  assetId: string;
  className?: string;
  /**
   * When true, append a media fragment so the browser paints the first frame as
   * a poster/thumbnail before playback starts. Used in the feed.
   */
  thumbnail?: boolean;
}) {
  const src = thumbnail ? `${getAssetUrl(assetId)}#t=0.1` : getAssetUrl(assetId);
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- captions not available for user-uploaded videos
    <video
      src={src}
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
