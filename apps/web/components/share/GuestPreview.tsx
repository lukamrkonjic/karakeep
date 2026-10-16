"use client";

import { useEffect, useState } from "react";
import { BookmarkMarkdownComponent } from "@/components/dashboard/bookmarks/BookmarkMarkdownComponent";
import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import type { PreviewMedia } from "@/components/dashboard/preview/MediaFitPreview";
import {
  getPreviewMedia,
  MediaFitPreview,
} from "@/components/dashboard/preview/MediaFitPreview";
import { TouchZoomImage } from "@/components/dashboard/preview/TouchZoomImage";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useAssetUrl } from "@/lib/assetUrl";
import { isEmojiIcon } from "@/lib/emoji";
import { useIsPhone } from "@/lib/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Info,
  X,
} from "lucide-react";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { ZGuestShareList } from "@karakeep/shared/types/guestShares";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { getSourceUrl } from "@karakeep/shared/utils/bookmarkUtils";

import { guestTitle, hostOf, useLinkImage } from "./GuestGrid";

/**
 * Fork: a bookmark opened from a guest link — as the app's own preview: a
 * picture at its size, zooming and panning, a video playing, the details
 * beside them (MediaFitPreview); on a phone the whole screen, pinch to zoom,
 * swipe for the next. ← and → (or the arrows) go through the grid behind.
 * Its tags and lists lead back to the grid, searched or narrowed. Read-only:
 * nothing here changes anything.
 */
export function GuestPreview({
  token,
  bookmarkId,
  loaded,
  lists,
  onClose,
  onGo,
  onTag,
  onList,
  nearEnd,
}: {
  token: string;
  bookmarkId: string;
  /** The grid behind, in its order. */
  loaded: ZBookmark[];
  lists: ZGuestShareList[];
  onClose: () => void;
  onGo: (bookmarkId: string) => void;
  onTag: (tag: string) => void;
  onList: (listId: string) => void;
  /** Close to the end of what's loaded: the grid loads more. */
  nearEnd: () => void;
}) {
  const api = useTRPC();
  const isPhone = useIsPhone();
  const inGrid = loaded.find((b) => b.id === bookmarkId);
  const { data, error } = useQuery(
    api.guestShares.bookmark.queryOptions({ token, bookmarkId }),
  );
  const bookmark = data?.bookmark ?? inGrid;
  const at = loaded.findIndex((b) => b.id === bookmarkId);
  const previous = at > 0 ? loaded[at - 1] : undefined;
  const next = at >= 0 ? loaded[at + 1] : undefined;

  useEffect(() => {
    if (at >= 0 && at >= loaded.length - 4) {
      nearEnd();
    }
  }, [at, loaded.length, nearEnd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        return;
      }
      if (e.key === "ArrowLeft" && previous) {
        onGo(previous.id);
      } else if (e.key === "ArrowRight" && next) {
        onGo(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previous, next, onGo]);

  // Not in the link (any more): nothing to show.
  useEffect(() => {
    if (error && !inGrid) {
      onClose();
    }
  }, [error, inGrid, onClose]);

  const media = bookmark ? getPreviewMedia(bookmark) : null;
  const details = bookmark ? (
    <GuestDetails
      bookmark={bookmark}
      media={media}
      listIds={data?.listIds ?? []}
      lists={lists}
      onTag={onTag}
      onList={onList}
    />
  ) : null;
  const content = bookmark ? <GuestContent bookmark={bookmark} /> : null;

  if (isPhone) {
    return (
      <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="fixed inset-0 z-50 outline-none"
          >
            <DialogPrimitive.Title className="sr-only">
              Preview
            </DialogPrimitive.Title>
            {bookmark && (
              <PhoneGuestViewer
                bookmark={bookmark}
                media={media}
                content={content}
                details={details}
                onClose={onClose}
                onPrevious={previous ? () => onGo(previous.id) : undefined}
                onNext={next ? () => onGo(next.id) : undefined}
              />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  const arrow =
    "fixed top-1/2 z-[51] -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white";
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95 duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {previous && (
          <button
            type="button"
            data-guest-nav
            aria-label="Previous"
            title="Previous (←)"
            onClick={() => onGo(previous.id)}
            className={cn(arrow, "left-3")}
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {next && (
          <button
            type="button"
            data-guest-nav
            aria-label="Next"
            title="Next (→)"
            onClick={() => onGo(next.id)}
            className={cn(arrow, "right-3")}
          >
            <ChevronRight className="size-6" />
          </button>
        )}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // The arrows are outside the dialog: they don't close it.
          onPointerDownOutside={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest("[data-guest-nav]")
            ) {
              e.preventDefault();
            }
          }}
          className="fixed inset-0 z-50 m-auto h-fit w-fit max-w-[90vw] overflow-hidden rounded-xl bg-background shadow-lg outline-none duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 [&:has([data-media-pending])]:invisible"
        >
          <DialogPrimitive.Title className="sr-only">
            {bookmark ? (guestTitle(bookmark) ?? "Preview") : "Preview"}
          </DialogPrimitive.Title>
          {!bookmark ? (
            <div className="flex h-[50vh] w-[min(560px,90vw)] items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : media ? (
            <MediaFitPreview
              key={media.assetId}
              media={media}
              details={details}
              onClose={onClose}
            />
          ) : (
            <div className="flex h-[min(800px,90vh)] w-[min(1100px,90vw)]">
              <div className="min-w-0 flex-1 overflow-y-auto p-6">
                {content}
              </div>
              <div className="w-[360px] shrink-0 overflow-y-auto border-l bg-muted/40 p-5">
                {details}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** What a bookmark that isn't a picture or video shows: the page, the note. */
function GuestContent({ bookmark }: { bookmark: ZBookmark }) {
  const assetUrl = useAssetUrl();
  const linkImage = useLinkImage(bookmark);
  const title = guestTitle(bookmark);
  switch (bookmark.content.type) {
    case BookmarkTypes.LINK:
      return (
        <div className="mx-auto max-w-2xl space-y-4">
          {linkImage && (
            // oxlint-disable-next-line no-img-element -- any site's picture
            <img
              src={linkImage}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full rounded-lg object-cover"
            />
          )}
          <h2 className="text-2xl font-semibold leading-tight">
            {title ?? bookmark.content.url}
          </h2>
          {bookmark.content.description && (
            <p className="text-muted-foreground">
              {bookmark.content.description}
            </p>
          )}
          <Button asChild>
            <a href={bookmark.content.url} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 size-4" />
              Open {hostOf(bookmark.content.url)}
            </a>
          </Button>
        </div>
      );
    case BookmarkTypes.TEXT:
      return (
        <div className="mx-auto max-w-2xl">
          {title && <h2 className="mb-3 text-2xl font-semibold">{title}</h2>}
          <BookmarkMarkdownComponent readOnly>
            {{ id: bookmark.id, content: { text: bookmark.content.text } }}
          </BookmarkMarkdownComponent>
        </div>
      );
    case BookmarkTypes.ASSET:
    default: {
      const file =
        bookmark.content.type === BookmarkTypes.ASSET
          ? bookmark.content.assetId
          : null;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <FileText className="size-16 text-muted-foreground" />
          <p className="font-medium">{title ?? "File"}</p>
          {file && (
            <Button asChild>
              <a href={assetUrl(file)} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 size-4" />
                Open
              </a>
            </Button>
          )}
        </div>
      );
    }
  }
}

function GuestDetails({
  bookmark,
  media,
  listIds,
  lists,
  onTag,
  onList,
}: {
  bookmark: ZBookmark;
  media: PreviewMedia | null;
  listIds: string[];
  lists: ZGuestShareList[];
  onTag: (tag: string) => void;
  onList: (listId: string) => void;
}) {
  const assetUrl = useAssetUrl();
  const title = guestTitle(bookmark);
  const source = getSourceUrl(bookmark);
  const inLists = lists.filter((l) => listIds.includes(l.id));
  const chip =
    "inline-flex max-w-full items-center gap-1 truncate rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground transition-colors hover:bg-foreground hover:text-background";
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-1">
        {title && (
          <h2 className="break-words text-lg font-semibold leading-snug">
            {title}
          </h2>
        )}
        <p className="text-xs text-muted-foreground">
          Saved{" "}
          {bookmark.createdAt.toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>
      {source && (
        <a
          href={source}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 break-all text-primary hover:underline"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          {hostOf(source)}
        </a>
      )}
      {media && (
        <a
          href={assetUrl(media.assetId)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          Open the {media.kind === "image" ? "picture" : "video"} on its own
        </a>
      )}
      {bookmark.note && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Note
          </p>
          <p className="whitespace-pre-wrap break-words">{bookmark.note}</p>
        </div>
      )}
      {inLists.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            In
          </p>
          <div className="flex flex-wrap gap-1.5">
            {inLists.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onList(l.id)}
                className={chip}
              >
                {isEmojiIcon(l.icon) && <span>{l.icon}</span>}
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {bookmark.tags.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {bookmark.tags.map((t) => (
              <button
                key={t.id}
                type="button"
                title={`Search for #${t.name}`}
                onClick={() => onTag(t.name)}
                className={chip}
              >
                #{t.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * On a phone: the whole screen, as the phone's photo viewer — the picture on
 * black, pinch to zoom, swipe sideways for the next, down to close, a tap
 * hides the bars; Details in a sheet. Anything else as a page.
 */
function PhoneGuestViewer({
  bookmark,
  media,
  content,
  details,
  onClose,
  onPrevious,
  onNext,
}: {
  bookmark: ZBookmark;
  media: PreviewMedia | null;
  content: React.ReactNode;
  details: React.ReactNode;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const assetUrl = useAssetUrl();
  const [bars, setBars] = useState(true);
  const [info, setInfo] = useState(false);
  const title = guestTitle(bookmark);
  const dark = media !== null;
  const barButton = cn(
    "rounded-full p-2",
    dark ? "text-white hover:bg-white/10" : "hover:bg-muted",
  );
  return (
    <div
      className={cn(
        "relative flex h-full flex-col",
        dark ? "bg-black text-white" : "bg-background",
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] transition-opacity",
          dark && "bg-gradient-to-b from-black/60 to-transparent",
          !bars && "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={barButton}
        >
          <X className="size-6" />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        <button
          type="button"
          aria-label="Details"
          onClick={() => setInfo(true)}
          className={barButton}
        >
          <Info className="size-6" />
        </button>
      </div>
      {media?.kind === "image" ? (
        <TouchZoomImage
          key={media.assetId}
          src={assetUrl(media.assetId)}
          alt={title ?? "Picture"}
          onTap={() => setBars((b) => !b)}
          onSwipeDown={onClose}
          onSwipeLeft={onNext}
          onSwipeRight={onPrevious}
        />
      ) : media ? (
        <div className="flex flex-1 items-center justify-center">
          <BookmarkVideo
            key={media.assetId}
            assetId={media.assetId}
            thumbnailAssetId={media.posterAssetId}
            autoPlay
            className="max-h-full w-full"
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-16">{content}</div>
      )}
      {(onPrevious ?? onNext) && media?.kind !== "image" && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex justify-between px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity",
            !bars && "pointer-events-none opacity-0",
          )}
        >
          <button
            type="button"
            aria-label="Previous"
            disabled={!onPrevious}
            onClick={onPrevious}
            className={cn(barButton, "disabled:opacity-0")}
          >
            <ChevronLeft className="size-7" />
          </button>
          <button
            type="button"
            aria-label="Next"
            disabled={!onNext}
            onClick={onNext}
            className={cn(barButton, "disabled:opacity-0")}
          >
            <ChevronRight className="size-7" />
          </button>
        </div>
      )}
      <BottomSheet open={info} onOpenChange={setInfo} title="Details">
        <div className="px-4 pb-4">{details}</div>
      </BottomSheet>
    </div>
  );
}
