"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonWithTooltip } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import LoadingSpinner from "@/components/ui/spinner";
import {
  BOOKMARK_DRAG_MIME,
  setDraggedBookmarkCount,
} from "@/lib/bookmark-drag";
import { setBookmarkDragImage } from "@/lib/bookmarkDragImage";
import { useIsTouch } from "@/lib/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Check, Search, Settings, X } from "lucide-react";
import { useInView } from "react-intersection-observer";
import Masonry from "react-masonry-css";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import { BookmarkListSelector } from "../../lists/BookmarkListSelector";
import { boardPictureOf, rememberPictureSize } from "./boardPictures";

/** The value, once it's stopped changing for a moment. */
function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The panel's width, and its pictures': each viewer's own, kept here. */
const WIDTH = { key: "vrana-board-panel-width", min: 260, initial: 380 };
const THUMB = {
  key: "vrana-board-panel-thumb",
  min: 72,
  max: 320,
  initial: 140,
};
/** The board keeps at least this much of the room beside the panel. */
const BOARD_ROOM = 240;
/** Between pictures, and the grid's padding either side. */
const GAP = 8;
const PADDING = 24;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

function remembered(key: string, fallback: number) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Not kept: it opens as it was.
  }
}

/**
 * The panel's left edge, to drag it wider or narrower (the board keeps
 * BOARD_ROOM); a double-click puts it back, the arrow keys move it too.
 */
function ResizeHandle({
  width,
  setWidth,
}: {
  width: number;
  setWidth: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);
  const latest = useRef(width);
  latest.current = width;
  const maxOf = (el: HTMLElement) =>
    (el.parentElement?.parentElement?.clientWidth ?? Infinity) - BOARD_ROOM;
  // As shown: a narrow window may hold it narrower than it was set.
  const shownOf = (el: HTMLElement) =>
    el.parentElement?.getBoundingClientRect().width ?? width;
  const done = () => {
    drag.current = null;
    document.body.style.cursor = "";
    remember(WIDTH.key, latest.current);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) {
          return;
        }
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          width: shownOf(e.currentTarget),
          max: maxOf(e.currentTarget),
        };
        document.body.style.cursor = "col-resize";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) {
          setWidth(clamp(d.width + d.x - e.clientX, WIDTH.min, d.max));
        }
      }}
      onPointerUp={done}
      onPointerCancel={done}
      onDoubleClick={() => {
        setWidth(WIDTH.initial);
        remember(WIDTH.key, WIDTH.initial);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 24;
        const by =
          e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
        if (by) {
          e.preventDefault();
          const next = clamp(
            shownOf(e.currentTarget) + by,
            WIDTH.min,
            maxOf(e.currentTarget),
          );
          setWidth(next);
          remember(WIDTH.key, next);
        }
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}

/** A page of bookmarks to pick from: a list's (or all), or a search's. */
function usePickable(listId: string | null, text: string) {
  const api = useTRPC();
  const searching = text.trim().length > 0;
  const browse = useInfiniteQuery(
    api.bookmarks.getBookmarks.infiniteQueryOptions(
      {
        listId: listId ?? undefined,
        archived: false,
        includeContent: false,
        limit: 40,
      },
      {
        enabled: !searching,
        initialCursor: null,
        getNextPageParam: (page) => page.nextCursor,
        placeholderData: keepPreviousData,
      },
    ),
  );
  const search = useInfiniteQuery(
    api.pictures.search.infiniteQueryOptions(
      { text, listIds: listId ? [listId] : undefined },
      {
        enabled: searching,
        initialCursor: 0,
        getNextPageParam: (page) => page.nextCursor,
        placeholderData: keepPreviousData,
      },
    ),
  );
  const query = searching ? search : browse;
  const bookmarks = useMemo(
    () =>
      (query.data?.pages ?? []).flatMap(
        (page) => page.bookmarks as ZBookmark[],
      ),
    [query.data],
  );
  return {
    bookmarks,
    loading: query.isPending,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

function Thumb({
  bookmark,
  picked,
  onBoard,
  draggedIds,
  onToggle,
}: {
  bookmark: ZBookmark;
  picked: boolean;
  onBoard: boolean;
  /** What a drag from it carries: the picked ones when it's one of them. */
  draggedIds: () => string[];
  onToggle: () => void;
}) {
  const picture = boardPictureOf(bookmark);
  const title = getBookmarkTitle(bookmark);
  const isTouch = useIsTouch();
  return (
    <button
      type="button"
      draggable={!isTouch}
      onDragStart={(e) => {
        const ids = draggedIds();
        e.dataTransfer.setData(BOOKMARK_DRAG_MIME, ids.join(","));
        e.dataTransfer.effectAllowed = "copy";
        setDraggedBookmarkCount(ids.length);
        setBookmarkDragImage(e, title ?? "", ids.length);
      }}
      onClick={onToggle}
      title={title ?? undefined}
      aria-pressed={picked}
      className={cn(
        "group relative mb-2 block w-full overflow-hidden rounded-md bg-muted text-left outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring",
        picked && "ring-2 ring-primary ring-offset-2",
      )}
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- the server's file, as the grid shows it
        <img
          src={picture.src}
          alt={title ?? ""}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => rememberPictureSize(bookmark.id, e.currentTarget)}
          className={cn(
            "block h-auto w-full",
            onBoard && !picked && "opacity-60",
          )}
        />
      ) : (
        <span className="line-clamp-4 block p-2 text-xs text-muted-foreground">
          {title ??
            (bookmark.content.type === "text" ? bookmark.content.text : "")}
        </span>
      )}
      {(picked || onBoard) && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full shadow",
            picked
              ? "bg-primary text-primary-foreground"
              : "bg-background/90 text-foreground",
          )}
          title={onBoard ? "On the board" : undefined}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

/**
 * Fork: a board's Add pictures panel — your pictures, a list's (the
 * picker at its top) or a search's (words, colours, what's in them, as the
 * search bar finds them). Drag one (or the ones picked) onto the board to
 * put them where they drop, or pick some and Add them to the middle of what
 * the board shows. Those already on the board are ticked. Its left edge
 * drags it wider (`resizable`), and its view options (the gear, as the main
 * grid has) size the pictures: the grid has as many columns as fit.
 */
export function PicturePanel({
  onBoard,
  onAdd,
  onClose,
  resizable = false,
  className,
}: {
  /** Bookmarks already on the board. */
  onBoard: ReadonlySet<string>;
  onAdd: (bookmarkIds: string[]) => void;
  onClose: () => void;
  /** Beside the board, its width the viewer's (not over it, on a phone). */
  resizable?: boolean;
  className?: string;
}) {
  const [width, setWidth] = useState(() =>
    remembered(WIDTH.key, WIDTH.initial),
  );
  const [thumb, setThumb] = useState(() =>
    clamp(remembered(THUMB.key, THUMB.initial), THUMB.min, THUMB.max),
  );
  // The grid's own width (no scrollbar), for its columns.
  const gridRef = useRef<HTMLDivElement>(null);
  // Until it's measured: about the panel's width, so it opens in columns.
  const [gridWidth, setGridWidth] = useState(() =>
    resizable ? width : window.innerWidth,
  );
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setGridWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(
    1,
    Math.floor((gridWidth - PADDING + GAP) / (thumb + GAP)),
  );

  const [listId, setListId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const settled = useSettled(text, 300);
  const [picked, setPicked] = useState<string[]>([]);
  const { bookmarks, loading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    usePickable(listId, settled);
  const { ref: endRef, inView } = useInView({ rootMargin: "400px" });
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggle = (id: string) =>
    setPicked((was) =>
      was.includes(id) ? was.filter((x) => x !== id) : [...was, id],
    );

  return (
    <aside
      aria-label="Add pictures"
      className={cn("relative flex min-h-0 flex-col bg-background", className)}
      style={
        resizable
          ? { width, maxWidth: `calc(100% - ${BOARD_ROOM}px)` }
          : undefined
      }
    >
      {resizable && <ResizeHandle width={width} setWidth={setWidth} />}
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <p className="font-medium">Add pictures</p>
        <div className="flex items-center">
          {/* As the main grid's view options: the pictures' size. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ButtonWithTooltip
                tooltip="View options"
                delayDuration={100}
                variant="ghost"
                size="none"
                className="size-7 rounded-md"
                aria-label="View options"
              >
                <Settings className="size-4" />
              </ButtonWithTooltip>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <div className="px-2 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">Picture size</span>
                  <span className="text-sm text-muted-foreground">
                    {columns} per row
                  </span>
                </div>
                <Slider
                  min={THUMB.min}
                  max={THUMB.max}
                  step={4}
                  value={[thumb]}
                  onValueChange={([value]) => setThumb(value)}
                  onValueCommit={([value]) => remember(THUMB.key, value)}
                  thumbLabels={["Picture size"]}
                  className="w-full"
                />
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>Small</span>
                  <span>Large</span>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="none"
            className="size-7 rounded-md"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <div className="flex items-center gap-1">
          <BookmarkListSelector
            value={listId}
            onChange={(id) => {
              setListId(id);
              setPicked([]);
            }}
            placeholder="All your pictures"
            className="h-9 min-w-0 flex-1 truncate text-sm font-normal"
          />
          {listId && (
            <Button
              variant="ghost"
              size="none"
              className="size-9 shrink-0 rounded-md"
              aria-label="All your pictures"
              title="All your pictures"
              onClick={() => setListId(null)}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listId ? "Search this list" : "Search"}
            className="h-9 pl-8 text-sm"
            aria-label="Search"
          />
        </div>
      </div>
      <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-3">
        {loading ? (
          <div className="flex justify-center py-10">
            <LoadingSpinner />
          </div>
        ) : bookmarks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing here.
          </p>
        ) : (
          <Masonry
            // In reading order, row by row, and steady as more load.
            breakpointCols={columns}
            className="-ml-2 flex w-auto"
            columnClassName="pl-2"
          >
            {bookmarks.map((bookmark) => (
              <Thumb
                key={bookmark.id}
                bookmark={bookmark}
                picked={picked.includes(bookmark.id)}
                onBoard={onBoard.has(bookmark.id)}
                draggedIds={() =>
                  picked.includes(bookmark.id) ? picked : [bookmark.id]
                }
                onToggle={() => toggle(bookmark.id)}
              />
            ))}
          </Masonry>
        )}
        <div ref={endRef} className="h-px" />
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <LoadingSpinner />
          </div>
        )}
      </div>
      <div className="border-t px-3 py-2.5">
        {picked.length > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                onAdd(picked);
                setPicked([]);
              }}
            >
              Add {picked.length} to the board
            </Button>
            <Button variant="ghost" onClick={() => setPicked([])}>
              Clear
            </Button>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Drag pictures onto the board, or pick some and add them. Files from
            your computer can be dropped on the board too.
          </p>
        )}
      </div>
    </aside>
  );
}
