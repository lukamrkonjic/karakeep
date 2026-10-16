"use client";

import { useEffect, useMemo } from "react";
import { BookmarkMarkdownComponent } from "@/components/dashboard/bookmarks/BookmarkMarkdownComponent";
import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import { GatedImage } from "@/components/dashboard/bookmarks/GatedImage";
import { getPreviewMedia } from "@/components/dashboard/preview/MediaFitPreview";
import { ActionButton } from "@/components/ui/action-button";
import { useAssetUrl } from "@/lib/assetUrl";
import { cn } from "@/lib/utils";
import tailwindConfig from "@/tailwind.config";
import { FileText, Link2 } from "lucide-react";
import { useInView } from "react-intersection-observer";
import Masonry from "react-masonry-css";
import resolveConfig from "tailwindcss/resolveConfig";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import {
  getBookmarkLinkAssetIdOrUrl,
  getBookmarkTitle,
} from "@karakeep/shared/utils/bookmarkUtils";

/** A bookmark's name as a guest sees it: its title, else its file's. */
export function guestTitle(bookmark: ZBookmark): string | null {
  const media = getPreviewMedia(bookmark);
  return (
    getBookmarkTitle(bookmark) ??
    (media
      ? bookmark.assets.find((a) => a.id === media.assetId)?.fileName
      : null) ??
    (bookmark.content.type === BookmarkTypes.ASSET
      ? bookmark.content.fileName
      : null) ??
    null
  );
}

/** A link's picture: its own banner or screenshot, else the page's. */
export function useLinkImage(bookmark: ZBookmark): string | null {
  const assetUrl = useAssetUrl();
  if (bookmark.content.type !== BookmarkTypes.LINK) {
    return null;
  }
  const image = getBookmarkLinkAssetIdOrUrl(bookmark.content);
  return image
    ? image.localAsset
      ? assetUrl(image.assetId)
      : image.url
    : null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A tile: a picture or video alone, as the app's masonry tiles
 * (MasonryMediaCard) — its title over it while a mouse is on it, a video
 * playing there (Settings' "Play videos on hover" is the guest's default) —
 * and a card for a link, a note or a file. A click opens it (the preview).
 */
function GuestTile({
  bookmark,
  index,
  onOpen,
}: {
  bookmark: ZBookmark;
  index: number;
  onOpen: () => void;
}) {
  const media = getPreviewMedia(bookmark);
  const title = guestTitle(bookmark);
  const linkImage = useLinkImage(bookmark);
  const open = {
    role: "button",
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
    "data-bookmark-index": index,
    "aria-label": title ?? "Open",
  } as const;

  if (media) {
    return (
      <div
        {...open}
        className="group relative mb-2 cursor-pointer overflow-hidden rounded-lg outline-none ring-primary focus-visible:ring-2 sm:mb-4"
      >
        <div className="transition-[filter] duration-200 group-hover:brightness-[0.6]">
          {media.kind === "image" ? (
            <GatedImage assetId={media.assetId} alt={title ?? "Picture"} />
          ) : (
            <BookmarkVideo
              assetId={media.assetId}
              thumbnailAssetId={media.posterAssetId}
              thumbnail
              className="w-full"
            />
          )}
        </div>
        {title && (
          <div className="pointer-events-none absolute inset-x-0 top-0 truncate p-2 text-sm font-medium text-white opacity-0 drop-shadow transition-opacity duration-200 group-hover:opacity-100 touch:hidden">
            {title}
          </div>
        )}
      </div>
    );
  }

  const card =
    "mb-2 cursor-pointer overflow-hidden rounded-lg bg-card shadow-sm outline-none ring-primary transition-shadow hover:shadow-md focus-visible:ring-2 sm:mb-4";
  switch (bookmark.content.type) {
    case BookmarkTypes.LINK: {
      const url = bookmark.content.url;
      return (
        <div {...open} className={card}>
          {linkImage && (
            // oxlint-disable-next-line no-img-element -- any site's picture
            <img
              src={linkImage}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="block aspect-video w-full object-cover"
            />
          )}
          <div className="space-y-1.5 p-3">
            <p className="line-clamp-2 font-medium leading-snug">
              {title ?? url}
            </p>
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {bookmark.content.favicon ? (
                // oxlint-disable-next-line no-img-element -- any site's icon
                <img
                  src={bookmark.content.favicon}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-3.5 shrink-0 rounded-sm"
                />
              ) : (
                <Link2 className="size-3.5 shrink-0" />
              )}
              {hostOf(url)}
            </p>
          </div>
        </div>
      );
    }
    case BookmarkTypes.TEXT:
      return (
        <div {...open} className={card}>
          <div className="relative max-h-64 overflow-hidden p-3">
            {title && <p className="mb-1 font-medium">{title}</p>}
            <div className="pointer-events-none text-sm">
              <BookmarkMarkdownComponent readOnly>
                {{ id: bookmark.id, content: { text: bookmark.content.text } }}
              </BookmarkMarkdownComponent>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card" />
          </div>
        </div>
      );
    case BookmarkTypes.ASSET:
    default:
      return (
        <div {...open} className={cn(card, "flex items-center gap-3 p-3")}>
          <FileText className="size-8 shrink-0 text-muted-foreground" />
          <p className="line-clamp-2 text-sm font-medium">{title ?? "File"}</p>
        </div>
      );
  }
}

function breakpoints(columns: number, phoneColumns: number) {
  const screens = resolveConfig(tailwindConfig).theme.screens;
  return {
    default: columns,
    [parseInt(screens.lg)]: Math.max(1, columns - 1),
    [parseInt(screens.md)]: Math.max(1, Math.min(columns, 2)),
    [parseInt(screens.sm)]: phoneColumns,
  };
}

export function GuestGrid({
  bookmarks,
  columns,
  phoneColumns,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  onOpen,
}: {
  bookmarks: ZBookmark[];
  columns: number;
  phoneColumns: number;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  onOpen: (bookmarkId: string) => void;
}) {
  const breakpointCols = useMemo(
    () => breakpoints(columns, phoneColumns),
    [columns, phoneColumns],
  );
  const { ref, inView } = useInView({ rootMargin: "800px" });
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <Masonry
        breakpointCols={breakpointCols}
        className="-ml-2 flex w-auto sm:-ml-4"
        columnClassName="pl-2 sm:pl-4"
      >
        {bookmarks.map((b, i) => (
          <GuestTile
            key={b.id}
            bookmark={b}
            index={i}
            onOpen={() => onOpen(b.id)}
          />
        ))}
      </Masonry>
      {hasNextPage && (
        <div className="flex justify-center py-4">
          <ActionButton
            ref={ref}
            ignoreDemoMode
            loading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
            variant="ghost"
          >
            Load more
          </ActionButton>
        </div>
      )}
    </>
  );
}
