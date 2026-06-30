"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

/**
 * Inline HTML5 player for video attachments (assetType === "video").
 *
 * Kept as a standalone component to minimise the upstream-merge surface: the
 * card/preview files only need a one-line call to render a video.
 *
 * - In the feed (`thumbnail`), the player is *lazily mounted* via an
 *   IntersectionObserver: a list with dozens of videos would otherwise fire a
 *   metadata request per video on load and overwhelm the server. Until a card
 *   nears the viewport it renders a cheap black placeholder.
 * - `preload="metadata"` means we only fetch each video's header + first frame
 *   (not the whole file) until the user hits play.
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
   * Feed mode: lazy-mount when near the viewport and append a media fragment so
   * the browser paints the first frame as a poster/thumbnail before playback.
   */
  thumbnail?: boolean;
}) {
  const src = thumbnail
    ? `${getAssetUrl(assetId)}#t=0.1`
    : getAssetUrl(assetId);

  // Detail view (thumbnail === false) mounts immediately; feed cards wait until
  // they scroll close to the viewport.
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!thumbnail);

  useEffect(() => {
    if (visible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div
        ref={containerRef}
        className={cn(
          // aspect-video gives the placeholder a size before load; it's inert
          // when the caller already constrains height (e.g. the h-56 feed grid).
          "flex aspect-video items-center justify-center bg-black text-white/70",
          className,
        )}
      >
        <Play className="size-10" />
      </div>
    );
  }

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
