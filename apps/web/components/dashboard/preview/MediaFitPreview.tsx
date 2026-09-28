"use client";

import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import {
  usePreviewDetailsHidden,
  useTogglePreviewDetails,
} from "@/lib/previewDetails";
import { cn } from "@/lib/utils";
import { ExternalLink, PanelRightClose, PanelRightOpen } from "lucide-react";

import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { ZoomableImage } from "./ZoomableImage";

export interface PreviewMedia {
  kind: "image" | "video";
  assetId: string;
  /** A video's extracted poster frame, when the worker has made one. */
  posterAssetId?: string;
}

/**
 * The picture or video a bookmark is, when it is one: an uploaded image or
 * video, or a note carrying a video (how imported videos arrive).
 */
export function getPreviewMedia(bookmark: ZBookmark): PreviewMedia | null {
  const posterAssetId = bookmark.assets.find(
    (a) => a.assetType === "videoThumbnail",
  )?.id;
  if (bookmark.content.type === BookmarkTypes.ASSET) {
    const { assetType, assetId } = bookmark.content;
    if (assetType === "image") {
      return { kind: "image", assetId };
    }
    if (assetType === "video") {
      return { kind: "video", assetId, posterAssetId };
    }
    return null;
  }
  if (bookmark.content.type === BookmarkTypes.TEXT) {
    const video = bookmark.assets.find((a) => a.assetType === "video");
    if (video) {
      return { kind: "video", assetId: video.id, posterAssetId };
    }
  }
  return null;
}

/**
 * The preview modal for a picture or a video: the dialog wraps the media at
 * its own size, within bounds, and the details sit beside it in a panel
 * exactly as tall as the media that scrolls on its own.
 *
 * The bounds: never more than 90% of the screen either way, and never less
 * than a comfortable frame (FRAME) — a small picture sits at its own size in
 * the middle of it, on the theme's backdrop (light or dark), instead of
 * shrinking the dialog and squeezing the details beside it. Never blown up:
 * a small picture stays sharp.
 *
 * The panel is absolutely positioned inside its column so it never adds
 * height: the media (or the frame) decides how tall the dialog is. Hiding it
 * is one remembered setting for every preview, and a picture zooms and pans
 * (ZoomableImage). Clicking a picture closes the preview (`onClose`); its
 * open button, beside the details toggle, opens the file in a new tab. A
 * video keeps clicks for its player.
 */
export function MediaFitPreview({
  media,
  details,
  onClose,
}: {
  media: PreviewMedia;
  details: React.ReactNode;
  onClose?: () => void;
}) {
  // One remembered setting for every preview (lib/previewDetails.ts).
  const panelOpen = !usePreviewDetailsHidden();
  const togglePanel = useTogglePreviewDetails();
  // At most 90% of the screen; the widths are kept in step with the panel's
  // w-[360px] below. (Whole class names: Tailwind only sees literal ones.)
  const fit = cn(
    "block h-auto max-h-[90vh] w-auto",
    panelOpen ? "max-w-[calc(90vw-360px)]" : "max-w-[90vw]",
  );
  // FRAME: at least 560 × 720 (less on a small screen), the media centred
  // on the theme's backdrop — a light stage by day, a dark one at night.
  const pane = cn(
    "relative flex min-h-[min(720px,90vh)] items-center justify-center bg-secondary dark:bg-background",
    panelOpen
      ? "min-w-[min(560px,calc(90vw-360px))]"
      : "min-w-[min(560px,90vw)]",
  );
  const button =
    "rounded-md bg-black/40 p-1.5 text-white/80 transition-colors hover:bg-black/60 hover:text-white";
  const src = getAssetUrl(media.assetId);
  const controls = (
    <div
      data-pane-controls
      className="absolute right-3 top-3 z-10 flex items-center gap-1"
    >
      {media.kind === "image" && (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label="Open image"
          title="Open image"
          className={button}
        >
          <ExternalLink size={18} />
        </a>
      )}
      <button
        type="button"
        onClick={togglePanel}
        aria-label={panelOpen ? "Hide details" : "Show details"}
        title={panelOpen ? "Hide details" : "Show details"}
        className={button}
      >
        {panelOpen ? (
          <PanelRightClose size={18} />
        ) : (
          <PanelRightOpen size={18} />
        )}
      </button>
    </div>
  );

  return (
    <div className="flex max-h-[90vh]">
      {media.kind === "image" ? (
        <ZoomableImage
          src={src}
          className={pane}
          imageClassName={fit}
          onClick={onClose}
        >
          {controls}
        </ZoomableImage>
      ) : (
        <div className={pane}>
          <BookmarkVideo
            assetId={media.assetId}
            thumbnailAssetId={media.posterAssetId}
            autoPlay
            className={fit}
          />
          {controls}
        </div>
      )}
      {panelOpen && (
        <div className="relative w-[360px] shrink-0 border-l bg-muted/40">
          <div className="absolute inset-0 overflow-y-auto p-5">{details}</div>
        </div>
      )}
    </div>
  );
}
