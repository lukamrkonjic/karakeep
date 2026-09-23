"use client";

import { Fragment, useEffect, useState } from "react";
import { toast } from "@/components/ui/sonner";
import useRelativeTime from "@/lib/hooks/relative-time";
import { useTranslation } from "@/lib/i18n/client";
import { formatBytes } from "@/lib/utils";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { useUpdateBookmark } from "@karakeep/shared-react/hooks/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { FavouritedActionIcon } from "../bookmarks/icons";
import type { PreviewMedia } from "./MediaFitPreview";

/**
 * A picture's or video's own size, read from the file the preview already
 * shows (a picture comes from the browser's cache; a video only needs its
 * header). Nothing is stored for it.
 */
function useMediaDimensions(media: PreviewMedia | null) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const src = media ? getAssetUrl(media.assetId) : null;
  const kind = media?.kind;
  useEffect(() => {
    setSize(null);
    if (!src) {
      return;
    }
    if (kind === "image") {
      const image = new window.Image();
      image.onload = () =>
        setSize({ w: image.naturalWidth, h: image.naturalHeight });
      image.src = src;
      return () => {
        image.onload = null;
      };
    }
    const video = document.createElement("video");
    const drop = () => {
      video.onloadedmetadata = null;
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      setSize({ w: video.videoWidth, h: video.videoHeight });
      drop();
    };
    video.src = src;
    return drop;
  }, [src, kind]);
  return size;
}

/** "photo.final.JPG" → "JPG". */
function extensionOf(fileName: string | null | undefined) {
  return fileName?.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toUpperCase();
}

/**
 * The file's type ("JPG", "MP4"), else what kind of bookmark it is. A note
 * carrying a video (how imported videos arrive) is a video like any other.
 */
function typeOf(bookmark: ZBookmark, media: PreviewMedia | null): string {
  const content = bookmark.content;
  switch (content.type) {
    case BookmarkTypes.ASSET:
      return (
        extensionOf(content.fileName) ??
        { image: "Image", video: "Video", pdf: "PDF" }[content.assetType]
      );
    case BookmarkTypes.LINK:
      return "Link";
    case BookmarkTypes.TEXT: {
      if (!media) {
        return "Note";
      }
      const file = bookmark.assets.find((a) => a.id === media.assetId);
      return extensionOf(file?.fileName) ?? "Video";
    }
    default:
      return "Unknown";
  }
}

/** Where Eagle has its Rating: one star, lit when it's a favourite. */
function FavouriteToggle({
  bookmark,
  readOnly,
}: {
  bookmark: ZBookmark;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  // Lit (or not) at once; the saved state follows.
  const [favourited, setFavourited] = useState(bookmark.favourited);
  useEffect(() => setFavourited(bookmark.favourited), [bookmark.favourited]);
  const { mutate } = useUpdateBookmark({
    onError: () => {
      setFavourited(bookmark.favourited);
      toast({ variant: "destructive", description: "Something went wrong" });
    },
  });

  const star = (
    <FavouritedActionIcon
      favourited={favourited}
      size={15}
      strokeWidth={1.75}
    />
  );
  if (readOnly) {
    return <span className="flex text-muted-foreground">{star}</span>;
  }
  const label = favourited ? t("actions.unfavorite") : t("actions.favorite");
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={favourited}
      title={label}
      onClick={() => {
        setFavourited(!favourited);
        mutate({ bookmarkId: bookmark.id, favourited: !favourited });
      }}
      className="flex rounded text-muted-foreground transition-colors hover:text-foreground"
    >
      {star}
    </button>
  );
}

function DateValue({ date }: { date: Date }) {
  const { i18n } = useTranslation();
  // Formatted after mounting, in this browser's time zone (as upstream's
  // creation time does), so the server's render can't disagree.
  const { fromNow, localCreatedAt } = useRelativeTime(date, i18n.language);
  return <span title={fromNow}>{localCreatedAt}</span>;
}

/**
 * Fork: the details panel's Properties, laid out like Eagle's — what the
 * bookmark already knows about itself, one label/value row each.
 */
export function BookmarkProperties({
  bookmark,
  media,
  readOnly = false,
}: {
  bookmark: ZBookmark;
  media: PreviewMedia | null;
  readOnly?: boolean;
}) {
  const dimensions = useMediaDimensions(media);
  const content = bookmark.content;

  const rows: [string, React.ReactNode][] = [
    [
      "Favourite",
      <FavouriteToggle
        key="favourite"
        bookmark={bookmark}
        readOnly={readOnly}
      />,
    ],
  ];
  if (dimensions) {
    rows.push(["Dimensions", `${dimensions.w} × ${dimensions.h}`]);
  }
  if (content.type === BookmarkTypes.ASSET && content.size) {
    rows.push(["Size", formatBytes(content.size)]);
  }
  rows.push(["Type", typeOf(bookmark, media)]);
  if (content.type === BookmarkTypes.LINK) {
    if (content.author) {
      rows.push(["Author", content.author]);
    }
    if (content.publisher) {
      rows.push(["Publisher", content.publisher]);
    }
    if (content.datePublished) {
      rows.push([
        "Published",
        <DateValue key="published" date={content.datePublished} />,
      ]);
    }
  }
  rows.push([
    "Date added",
    <DateValue key="added" date={bookmark.createdAt} />,
  ]);
  if (bookmark.modifiedAt) {
    rows.push([
      "Date modified",
      <DateValue key="modified" date={bookmark.modifiedAt} />,
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-foreground">Properties</p>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate text-foreground">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
