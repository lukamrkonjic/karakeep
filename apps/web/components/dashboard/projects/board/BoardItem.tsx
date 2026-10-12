"use client";

import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type {
  ZProjectItem,
  ZProjectNoteStyle,
} from "@karakeep/shared/types/projects";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import { boardPictureOf, rememberPictureSize } from "./boardPictures";

/** A note's type size, in board pixels. */
export const NOTE_FONT: Record<ZProjectNoteStyle["size"], number> = {
  s: 16,
  m: 24,
  l: 40,
  xl: 64,
};

/** A note's card: its background and words (none: words on the board). */
export const NOTE_LOOK: Record<
  ZProjectNoteStyle["colour"],
  { swatch: string; className: string }
> = {
  none: { swatch: "transparent", className: "text-foreground" },
  paper: {
    swatch: "hsl(var(--card))",
    className:
      "bg-card text-card-foreground shadow-[0_1px_3px_rgb(0_0_0/0.12)] ring-1 ring-border",
  },
  yellow: {
    swatch: "#fdf0b4",
    className: "bg-[#fdf0b4] text-stone-900 shadow-[0_1px_3px_rgb(0_0_0/0.18)]",
  },
  rose: {
    swatch: "#fbd5dc",
    className: "bg-[#fbd5dc] text-stone-900 shadow-[0_1px_3px_rgb(0_0_0/0.18)]",
  },
  sky: {
    swatch: "#cfe6fb",
    className: "bg-[#cfe6fb] text-stone-900 shadow-[0_1px_3px_rgb(0_0_0/0.18)]",
  },
  mint: {
    swatch: "#cdeedd",
    className: "bg-[#cdeedd] text-stone-900 shadow-[0_1px_3px_rgb(0_0_0/0.18)]",
  },
  lilac: {
    swatch: "#e3d9fb",
    className: "bg-[#e3d9fb] text-stone-900 shadow-[0_1px_3px_rgb(0_0_0/0.18)]",
  },
};

/** The words' look: bigger notes are headings. */
export function noteTextStyle(style: ZProjectNoteStyle): React.CSSProperties {
  const size = NOTE_FONT[style.size];
  return {
    fontSize: size,
    lineHeight: 1.25,
    fontWeight: style.size === "l" || style.size === "xl" ? 600 : 400,
    letterSpacing: style.size === "xl" ? "-0.02em" : undefined,
    padding:
      style.colour === "none"
        ? `${size * 0.1}px ${size * 0.15}px`
        : `${Math.max(12, size * 0.5)}px`,
  };
}

/** A picture's box: the picture, a video's frame, or a link or note card. */
function PictureView({
  bookmark,
  placeholder,
  onShape,
}: {
  bookmark: ZBookmark | undefined;
  placeholder?: string;
  onShape: (w: number, h: number) => void;
}) {
  if (!bookmark) {
    // Still on its way (or gone from under the board).
    return <div className="size-full rounded-[6px] bg-muted" />;
  }
  const picture = boardPictureOf(bookmark);
  const title = getBookmarkTitle(bookmark);
  if (picture) {
    return (
      <div
        className="relative size-full overflow-hidden rounded-[6px] shadow-[0_2px_8px_rgb(0_0_0/0.18)]"
        style={{ backgroundColor: placeholder ?? "hsl(var(--muted))" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the server's file, at whatever size the board shows it */}
        <img
          src={picture.src}
          alt={title ?? ""}
          draggable={false}
          decoding="async"
          className="pointer-events-none size-full select-none object-cover"
          onLoad={(e) => {
            const img = e.currentTarget;
            rememberPictureSize(bookmark.id, img);
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              onShape(img.naturalWidth, img.naturalHeight);
            }
          }}
        />
        {picture.video && (
          <span className="pointer-events-none absolute left-[6%] top-[6%] flex aspect-square w-[14%] min-w-4 max-w-12 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="size-1/2 translate-x-[6%] fill-current" />
          </span>
        )}
        {bookmark.content.type === BookmarkTypes.LINK && title && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-sm font-medium text-white">
            {title}
          </span>
        )}
      </div>
    );
  }
  const words =
    bookmark.content.type === BookmarkTypes.TEXT
      ? bookmark.content.text
      : bookmark.content.type === BookmarkTypes.LINK
        ? bookmark.content.url
        : "";
  return (
    <div className="flex size-full flex-col gap-1 overflow-hidden rounded-[6px] bg-card p-3 text-card-foreground shadow-[0_2px_8px_rgb(0_0_0/0.18)] ring-1 ring-border">
      {title && (
        <p className="line-clamp-2 text-sm font-semibold leading-snug">
          {title}
        </p>
      )}
      <p className="line-clamp-[12] whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {words}
      </p>
    </div>
  );
}

/** A note: words on the board, or on a card. Its height is its words'. */
function NoteView({
  item,
  editing,
  onEdited,
  onHeight,
}: {
  item: ZProjectItem;
  editing: boolean;
  onEdited: (text: string) => void;
  onHeight: (h: number) => void;
}) {
  const style = item.style ?? { size: "m", colour: "none" };
  const ref = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  const onEditedRef = useRef(onEdited);
  onEditedRef.current = onEdited;
  // What's written while it's being edited, until it's handed over — and
  // what it said when writing began.
  const draft = useRef<string | null>(editing ? (item.text ?? "") : null);
  const original = useRef(item.text ?? "");
  const finish = (onlyIfChanged = false) => {
    const text = draft.current;
    if (text === null || (onlyIfChanged && text === original.current)) {
      return;
    }
    draft.current = null;
    onEditedRef.current(text);
  };

  // Writing ends with a blur — or with the board taking it away (a click
  // on something else): what was written is kept either way.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      draft.current = item.text ?? "";
      original.current = item.text ?? "";
    } else if (!editing && wasEditing.current) {
      finish();
    }
    wasEditing.current = editing;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the start and end of writing only
  }, [editing]);
  // Gone mid-sentence (the page left): a change is kept. Only a change, so
  // a new note isn't taken for an empty one when React rehearses this.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it goes
  useEffect(() => () => finish(true), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() =>
      onHeightRef.current(el.offsetHeight),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = area.current;
    if (editing && el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div
      ref={ref}
      className={cn(
        "w-full whitespace-pre-wrap break-words rounded-[6px]",
        NOTE_LOOK[style.colour].className,
      )}
      style={noteTextStyle(style)}
    >
      {editing ? (
        <textarea
          ref={(el) => {
            area.current = el;
            if (el) {
              grow(el);
            }
          }}
          defaultValue={item.text ?? ""}
          onInput={(e) => {
            draft.current = e.currentTarget.value;
            grow(e.currentTarget);
          }}
          onBlur={() => finish()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" || (e.key === "Enter" && e.metaKey)) {
              e.currentTarget.blur();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Write something"
          className="block w-full resize-none overflow-hidden bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40"
          style={{
            font: "inherit",
            lineHeight: "inherit",
            letterSpacing: "inherit",
          }}
        />
      ) : item.text ? (
        item.text
      ) : (
        <span className="opacity-40">Write something</span>
      )}
    </div>
  );
}

/**
 * Fork: one thing on a project's board, at its place: a picture (any
 * bookmark — BoardCanvas moves, sizes and picks it) or a note. Drawn in the
 * board's own pixels; the board's zoom scales it all.
 */
export const BoardItem = memo(function BoardItem({
  item,
  bookmark,
  placeholder,
  rank,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  onShape,
  onNoteHeight,
  onNoteEdited,
}: {
  item: ZProjectItem;
  bookmark?: ZBookmark;
  /** The picture's main colour, shown while it loads. */
  placeholder?: string;
  /** Its place in the stack, from the bottom. */
  rank: number;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent, item: ZProjectItem) => void;
  onDoubleClick: (e: React.MouseEvent, item: ZProjectItem) => void;
  onContextMenu: (e: React.MouseEvent, item: ZProjectItem) => void;
  /** A picture's real width and height, once it's loaded. */
  onShape: (item: ZProjectItem, w: number, h: number) => void;
  onNoteHeight: (item: ZProjectItem, h: number) => void;
  onNoteEdited: (item: ZProjectItem, text: string) => void;
}) {
  const note = item.kind === "note";
  return (
    <div
      data-board-item={item.id}
      className={cn(
        "absolute left-0 top-0 touch-none select-none",
        editing ? "cursor-text" : "cursor-default",
      )}
      style={{
        transform: `translate(${item.x}px, ${item.y}px)`,
        width: item.w,
        height: note ? undefined : item.h,
        zIndex: rank,
        outline: selected
          ? "calc(2px / var(--board-scale)) solid hsl(var(--primary))"
          : undefined,
        outlineOffset: selected ? "calc(2px / var(--board-scale))" : undefined,
        borderRadius: 6,
      }}
      onPointerDown={(e) => onPointerDown(e, item)}
      onDoubleClick={(e) => onDoubleClick(e, item)}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      {note ? (
        <NoteView
          item={item}
          editing={editing}
          onEdited={(text) => onNoteEdited(item, text)}
          onHeight={(h) => onNoteHeight(item, h)}
        />
      ) : (
        <PictureView
          bookmark={bookmark}
          placeholder={placeholder}
          onShape={(w, h) => onShape(item, w, h)}
        />
      )}
    </div>
  );
});
