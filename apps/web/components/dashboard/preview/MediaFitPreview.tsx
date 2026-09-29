"use client";

import { useEffect, useState } from "react";
import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import type { MediaSize } from "@/lib/mediaSizes";
import { knownMediaSize, probeImageSize } from "@/lib/mediaSizes";
import {
  usePreviewDetailsHidden,
  useTogglePreviewDetails,
} from "@/lib/previewDetails";
import { cn } from "@/lib/utils";
import { ExternalLink, PanelRightClose, PanelRightOpen } from "lucide-react";

import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { CropPicture } from "./CropPicture";
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
 * a small picture stays sharp. Its size is known before it loads
 * (lib/mediaSizes.ts: its tile loaded the same file), so the dialog opens at
 * its final size and the picture fills in, whole, when it's there.
 *
 * The panel is absolutely positioned inside its column so it never adds
 * height: the media (or the frame) decides how tall the dialog is. Hiding it
 * is one remembered setting for every preview, and a picture zooms and pans
 * (ZoomableImage). Clicking a picture closes the preview (`onClose`); its
 * open button, beside the details toggle, opens the file in a new tab. A
 * video keeps clicks for its player.
 */
/**
 * The media's size before it has loaded: its tile's (the grid loaded the same
 * file), a video's poster's while its own isn't known, else read off the
 * file's header as it arrives.
 */
function useMediaSize(media: PreviewMedia): MediaSize | null {
  const known = () =>
    knownMediaSize(media.assetId) ?? knownMediaSize(media.posterAssetId);
  const [size, setSize] = useState<MediaSize | null>(known);
  useEffect(() => {
    if (size) {
      return;
    }
    const picture =
      media.kind === "image" ? media.assetId : media.posterAssetId;
    return picture ? probeImageSize(getAssetUrl(picture), setSize) : undefined;
  }, [size, media.kind, media.assetId, media.posterAssetId]);
  return size;
}

/** How long a preview waits, unseen, for its media's size before showing. */
const SIZE_WAIT_MS = 300;

export function MediaFitPreview({
  media,
  details,
  onClose,
  crop,
}: {
  media: PreviewMedia;
  details: React.ReactNode;
  onClose?: () => void;
  /**
   * Fork: a picture its owner can crop — the crop button sits after the zoom
   * buttons (it used to be in the details' footer, PreviewActions).
   */
  crop?: { bookmarkId: string; assetId: string; fileName?: string | null };
}) {
  const [cropping, setCropping] = useState(false);
  // One remembered setting for every preview (lib/previewDetails.ts).
  const panelOpen = !usePreviewDetailsHidden();
  const togglePanel = useTogglePreviewDetails();
  // Its box, worked out before it has loaded, so the dialog opens at its
  // final size and nothing moves when the picture arrives: a picture at its
  // own size, never blown up, a video as big as there's room for (only its
  // shape is known for sure: its poster may be smaller than it) — within
  // 90% of the screen, less the panel (w-[360px]).
  const size = useMediaSize(media);
  // The page has it loaded already (its tile): it shows at once.
  const [loadedBefore] = useState(() => knownMediaSize(media.assetId) !== null);
  const room = panelOpen ? "90vw - 360px" : "90vw";
  const box: React.CSSProperties | undefined = size
    ? {
        width:
          media.kind === "image"
            ? `min(${size.w}px, ${room}, 90vh * ${size.w / size.h})`
            : `min(${room}, 90vh * ${size.w / size.h})`,
        aspectRatio: `${size.w} / ${size.h}`,
      }
    : undefined;
  // Size unknown (rare: opened before its tile had loaded): unseen for a
  // moment while it's read, rather than seen growing.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), SIZE_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  // Without a size: at most 90% of the screen. (Whole class names: Tailwind
  // only sees literal ones.)
  const fit = size
    ? "block h-auto"
    : cn(
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
    <div
      className="flex max-h-[90vh]"
      // The dialog stays unseen while this is set (the preview's page).
      data-media-pending={!size && !waited ? "" : undefined}
    >
      {media.kind === "image" ? (
        <ZoomableImage
          src={src}
          className={pane}
          imageClassName={fit}
          imageStyle={box}
          showAtOnce={loadedBefore}
          onClick={onClose}
          onCrop={crop ? () => setCropping(true) : undefined}
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
            style={box}
          />
          {controls}
        </div>
      )}
      {panelOpen && (
        <div className="relative w-[360px] shrink-0 border-l bg-muted/40">
          <div className="absolute inset-0 overflow-y-auto p-5">{details}</div>
        </div>
      )}
      {/* Not inside ZoomableImage: a click in the dialog would reach the
          pane's click handler (React events follow the portal's parent) and
          close the preview. */}
      {crop && (
        <CropPicture
          bookmarkId={crop.bookmarkId}
          assetId={crop.assetId}
          fileName={crop.fileName}
          open={cropping}
          onOpenChange={setCropping}
        />
      )}
    </div>
  );
}
