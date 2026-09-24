"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import DeleteBookmarkConfirmationDialog from "@/components/dashboard/bookmarks/DeleteBookmarkConfirmationDialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { toast } from "@/components/ui/sonner";
import useBulkActionsStore from "@/lib/bulkActions";
import { haptic } from "@/lib/haptic";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  ExternalLink,
  Info,
  Share,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useUpdateBookmark } from "@karakeep/shared-react/hooks/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import type { PreviewMedia } from "./MediaFitPreview";
import { BookmarkListChips } from "./BookmarkListChips";
import { getPreviewMedia } from "./MediaFitPreview";
import { TouchZoomImage } from "./TouchZoomImage";

/**
 * Fork: a bookmark on a phone, full screen — a picture or video on black like
 * the phone's own photo viewer, anything else as a page. Tap the picture to
 * hide the bars; drag it down to close; drag sideways for the next or
 * previous bookmark of the page behind. The bar at the bottom holds what a
 * phone does most (favourite, lists, share); Details has the rest.
 */
export function PhoneViewer({
  bookmark,
  media,
  content,
  details,
  sourceUrl,
  isOwner,
  onClose,
}: {
  bookmark: ZBookmark;
  media: PreviewMedia | null;
  /** What a bookmark that isn't a picture or video shows. */
  content: React.ReactNode;
  /** The details panel (the desktop's side panel). */
  details: React.ReactNode;
  sourceUrl: string | null;
  isOwner: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [bars, setBars] = useState(true);
  const [sheet, setSheet] = useState<"details" | "lists" | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The bookmarks around this one, in the order the page behind shows them.
  const visible = useBulkActionsStore((state) => state.visibleBookmarks);
  const { previous, next } = useMemo(() => {
    const at = visible.findIndex((b) => b.id === bookmark.id);
    return at < 0
      ? { previous: undefined, next: undefined }
      : { previous: visible[at - 1], next: visible[at + 1] };
  }, [visible, bookmark.id]);
  // Their pictures, fetched ahead so a swipe shows one at once.
  useEffect(() => {
    for (const neighbour of [previous, next]) {
      const m = neighbour && getPreviewMedia(neighbour);
      if (m?.kind === "image") {
        new Image().src = getAssetUrl(m.assetId);
      }
    }
  }, [previous, next]);
  const go = (target: ZBookmark | undefined) =>
    target
      ? () => {
          haptic();
          router.replace(`/dashboard/preview/${target.id}`, { scroll: false });
        }
      : undefined;

  const { mutate: update } = useUpdateBookmark({
    onError: (e) => toast({ variant: "destructive", description: e.message }),
  });

  const title = getBookmarkTitle(bookmark) || "Untitled";
  const share = async () => {
    try {
      if (media?.kind === "image") {
        // The picture itself, so Save Image is among the choices.
        const blob = await (await fetch(getAssetUrl(media.assetId))).blob();
        const file = new File([blob], title.slice(0, 60) || "picture", {
          type: blob.type,
        });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      }
      await navigator.share({
        title,
        url: sourceUrl ?? undefined,
        text: sourceUrl ? undefined : title,
      });
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        toast({ variant: "destructive", description: "Couldn't share this." });
      }
    }
  };

  const dark = !!media;
  const bar = cn(
    "absolute inset-x-0 z-10 flex items-center transition-opacity duration-200",
    !bars && "pointer-events-none opacity-0",
  );
  const iconButton =
    "flex size-11 items-center justify-center rounded-full active:bg-white/15 [&_svg]:size-6";

  return (
    <div
      className={cn(
        // z-50: over the header and tab bar when it's a page, not a dialog.
        "fixed inset-0 z-50 flex flex-col",
        dark ? "bg-black text-white" : "bg-background text-foreground",
      )}
    >
      <div className="min-h-0 flex-1">
        {media?.kind === "image" ? (
          <TouchZoomImage
            key={bookmark.id}
            src={getAssetUrl(media.assetId)}
            alt={title}
            onTap={() => setBars((shown) => !shown)}
            onSwipeDown={onClose}
            onSwipeLeft={go(next)}
            onSwipeRight={go(previous)}
          />
        ) : media?.kind === "video" ? (
          <div className="flex h-full items-center justify-center">
            <BookmarkVideo
              key={bookmark.id}
              assetId={media.assetId}
              thumbnailAssetId={media.posterAssetId}
              autoPlay
              className="max-h-full w-full"
            />
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))]">
            {content}
          </div>
        )}
      </div>

      <div
        className={cn(
          bar,
          "top-0 gap-1 px-2 pb-6 pt-[max(0.5rem,env(safe-area-inset-top))]",
          dark
            ? "bg-gradient-to-b from-black/70 to-transparent"
            : "border-b bg-background/95 pb-2",
        )}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={iconButton}
        >
          <X />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-medium">
          {title}
        </span>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the source"
            className={iconButton}
          >
            <ExternalLink />
          </a>
        ) : (
          <span className="size-11" />
        )}
      </div>

      <div
        className={cn(
          bar,
          "bottom-0 justify-around px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-6",
          dark
            ? "bg-gradient-to-t from-black/70 to-transparent"
            : "border-t bg-background/95 pt-2",
        )}
      >
        {isOwner && (
          <button
            type="button"
            aria-label={bookmark.favourited ? "Unfavourite" : "Favourite"}
            onClick={() => {
              haptic();
              update({
                bookmarkId: bookmark.id,
                favourited: !bookmark.favourited,
              });
            }}
            className={iconButton}
          >
            <Star
              className={cn(
                bookmark.favourited && "fill-yellow-400 text-yellow-400",
              )}
            />
          </button>
        )}
        <button
          type="button"
          aria-label="Lists"
          onClick={() => setSheet("lists")}
          className={iconButton}
        >
          <ClipboardList />
        </button>
        <button
          type="button"
          aria-label="Share"
          onClick={() => void share()}
          className={iconButton}
        >
          <Share />
        </button>
        <button
          type="button"
          aria-label="Details"
          onClick={() => setSheet("details")}
          className={iconButton}
        >
          <Info />
        </button>
        {isOwner && (
          <button
            type="button"
            aria-label="Delete"
            onClick={() => setDeleting(true)}
            className={iconButton}
          >
            <Trash2 />
          </button>
        )}
      </div>

      <BottomSheet
        open={sheet === "lists"}
        onOpenChange={(open) => setSheet(open ? "lists" : null)}
        title="Lists"
        bodyClassName="px-5 pb-6"
      >
        <BookmarkListChips bookmarkId={bookmark.id} readOnly={!isOwner} />
      </BottomSheet>
      <BottomSheet
        open={sheet === "details"}
        onOpenChange={(open) => setSheet(open ? "details" : null)}
        title="Details"
        bodyClassName="px-5 pb-6"
      >
        {details}
      </BottomSheet>
      <DeleteBookmarkConfirmationDialog
        bookmark={bookmark}
        open={deleting}
        setOpen={setDeleting}
      />
    </div>
  );
}
