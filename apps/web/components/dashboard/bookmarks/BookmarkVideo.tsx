"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePreference } from "@/lib/uiPreferences";
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
 * - In the feed (`thumbnail`) the tile is its poster and a click opens the
 *   bookmark's preview modal, where it plays (`autoPlay`). No <video> is
 *   mounted per tile: many uploads (screen/meeting recordings especially)
 *   aren't "faststart", so even `preload="metadata"` reads deep into the file
 *   for a trailing moov atom, and doing that for every tile scrolling into
 *   view made the feed slow. Fork: hovering the card plays the video there
 *   (Settings → "Play videos on hover", muted or with sound) — one player,
 *   mounted while the pointer is on the card and dropped when it leaves.
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
  const frameRef = useRef<HTMLElement>(null);
  const hoverRef = useRef<HTMLVideoElement>(null);
  const playOnHover = usePreference("hoverVideoAutoplay") ?? true;
  const withSound = usePreference("hoverVideoSound") ?? false;
  const [hovering, setHovering] = useState(false);
  const [hoverPlaying, setHoverPlaying] = useState(false);

  // The whole card counts as hovering (its title and buttons sit on top of
  // the video, outside this element), where there is a card.
  useEffect(() => {
    const frame = frameRef.current;
    if (!thumbnail || !playOnHover || !frame) {
      return;
    }
    const host = frame.closest<HTMLElement>("[data-bookmark-index]") ?? frame;
    const enter = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        setHovering(true);
      }
    };
    const leave = () => {
      setHovering(false);
      setHoverPlaying(false);
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      leave();
    };
  }, [thumbnail, playOnHover]);

  useEffect(() => {
    const video = hoverRef.current;
    if (!hovering || !video) {
      return;
    }
    video.muted = !withSound;
    video.play().catch(() => {
      // Browsers only allow sound once the page has had a click: until then
      // it plays silently.
      if (!video.muted) {
        video.muted = true;
        void video.play().catch(() => undefined);
      }
    });
  }, [hovering, withSound]);

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
        {hovering && playOnHover && (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- a silent hover preview
          <video
            ref={hoverRef}
            src={getAssetUrl(assetId)}
            className="pointer-events-none absolute inset-0 size-full object-contain"
            loop
            playsInline
            preload="auto"
            onPlaying={() => setHoverPlaying(true)}
          />
        )}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity duration-200",
            // The play mark until a hover preview is actually playing.
            !hoverPlaying && "group-hover/video:opacity-100",
          )}
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-black/50">
            <Play className="ml-1 size-6 fill-current" />
          </span>
        </div>
      </>
    );
    const frame = cn("group/video relative block w-full", className);
    return bookmarkId ? (
      <Link
        ref={frameRef as React.Ref<HTMLAnchorElement>}
        href={`/dashboard/preview/${bookmarkId}`}
        className={frame}
        draggable={false}
        aria-label="Play video"
      >
        {poster}
      </Link>
    ) : (
      <div ref={frameRef as React.Ref<HTMLDivElement>} className={frame}>
        {poster}
      </div>
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
