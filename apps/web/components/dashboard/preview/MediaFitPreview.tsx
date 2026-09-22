"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import { cn } from "@/lib/utils";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

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
 * its own size, capped to the viewport, instead of floating it in a fixed
 * 90% box, and the details sit beside it in a panel exactly as tall as the
 * media that scrolls on its own. A small picture keeps a minimum frame so the
 * panel stays usable.
 *
 * The panel is absolutely positioned inside its column so it never adds
 * height: the media alone decides how tall the dialog is.
 */
export function MediaFitPreview({
  media,
  details,
}: {
  media: PreviewMedia;
  details: React.ReactNode;
}) {
  const [panelOpen, setPanelOpen] = useState(true);
  // Kept in step with the panel's w-[360px] below.
  const fit = cn(
    "block h-auto max-h-[92vh] w-auto",
    panelOpen ? "max-w-[calc(95vw-360px)]" : "max-w-[95vw]",
  );

  return (
    <div className="flex max-h-[92vh]">
      <div className="relative flex min-h-[min(420px,92vh)] min-w-[320px] items-center justify-center bg-black">
        {media.kind === "image" ? (
          <Link href={getAssetUrl(media.assetId)} target="_blank">
            <Image
              alt="asset"
              src={getAssetUrl(media.assetId)}
              width={0}
              height={0}
              sizes="95vw"
              unoptimized
              priority
              className={fit}
            />
          </Link>
        ) : (
          <BookmarkVideo
            assetId={media.assetId}
            thumbnailAssetId={media.posterAssetId}
            autoPlay
            className={fit}
          />
        )}
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          aria-label={panelOpen ? "Hide details" : "Show details"}
          title={panelOpen ? "Hide details" : "Show details"}
          className="absolute right-3 top-3 z-10 rounded-md bg-black/40 p-1.5 text-white/80 transition-colors hover:bg-black/60 hover:text-white"
        >
          {panelOpen ? (
            <PanelRightClose size={18} />
          ) : (
            <PanelRightOpen size={18} />
          )}
        </button>
      </div>
      {panelOpen && (
        <div className="relative w-[360px] shrink-0 border-l bg-muted/40">
          <div className="absolute inset-0 overflow-y-auto p-5">{details}</div>
        </div>
      )}
    </div>
  );
}
