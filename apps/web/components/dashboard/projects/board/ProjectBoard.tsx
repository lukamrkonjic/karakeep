"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { boardPalette } from "@/lib/boardPalette";
import { useIsPhone } from "@/lib/hooks/useIsPhone";
import { projectSummary, useAddToProject } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronLeft,
  ExternalLink,
  Heading,
  ImagePlus,
  LayoutGrid,
  Maximize,
  Minus,
  MoreHorizontal,
  Plus,
  Redo2,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { toast as sonner } from "sonner";

import type { Point } from "@karakeep/shared/projectLayout";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type {
  ZProject,
  ZProjectItem,
  ZProjectNoteStyle,
} from "@karakeep/shared/types/projects";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { boundsOf, fitView, tidy } from "@karakeep/shared/projectLayout";
import {
  PROJECT_NOTE_COLOURS,
  PROJECT_NOTE_SIZES,
} from "@karakeep/shared/types/projects";

import type { BoardActions, View } from "./BoardCanvas";
import { ProjectOptions } from "../ProjectOptions";
import {
  BoardCanvas,
  liftToTop,
  MAX_SCALE,
  sinkToBottom,
  zoomAround,
} from "./BoardCanvas";
import { NOTE_FONT, NOTE_LOOK } from "./BoardItem";
import {
  isBoardFile,
  seenPictureSizes,
  useUploadForBoard,
} from "./boardPictures";
import { PicturePanel } from "./PicturePanel";
import { useBoardState } from "./useBoardState";

const NOTE_KINDS: Record<
  "heading" | "text" | "sticky",
  { style: ZProjectNoteStyle; w: number }
> = {
  heading: { style: { size: "l", colour: "none" }, w: 420 },
  text: { style: { size: "m", colour: "none" }, w: 320 },
  sticky: { style: { size: "m", colour: "yellow" }, w: 240 },
};

const viewKey = (projectId: string) => `vrana-board-view:${projectId}`;

function savedView(projectId: string): View | null {
  try {
    const raw = window.localStorage.getItem(viewKey(projectId));
    const v = raw ? (JSON.parse(raw) as Partial<View>) : null;
    return v &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y) &&
      Number.isFinite(v.s) &&
      v.s! > 0
      ? (v as View)
      : null;
  } catch {
    return null;
  }
}

/** The board fills the window under it, down to the page's bottom gap. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) {
        return;
      }
      const parent = el.parentElement;
      const gap = parent
        ? parseFloat(getComputedStyle(parent).paddingBottom) || 0
        : 0;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(360, window.innerHeight - top - gap));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return { ref, height };
}

function ToolbarButton({
  label,
  onClick,
  children,
  active = false,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm transition-colors hover:bg-accent",
        active && "bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * What's picked, over it: a note's size and look, a picture's Open, and for
 * anything the stack and Remove. Hidden while things move.
 */
function SelectionToolbar({
  picked,
  view,
  size,
  onStyle,
  onOpen,
  onFront,
  onBack,
  onRemove,
  onTidy,
}: {
  picked: ZProjectItem[];
  view: View;
  size: { w: number; h: number };
  onStyle: (style: Partial<ZProjectNoteStyle>) => void;
  onOpen: (bookmarkId: string) => void;
  onFront: () => void;
  onBack: () => void;
  onRemove: () => void;
  onTidy: () => void;
}) {
  // Its own width, to keep all of it on the board near an edge.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const measured = ref.current?.offsetWidth ?? 0;
    if (measured !== width) {
      setWidth(measured);
    }
  });
  const box = boundsOf(picked);
  if (!box) {
    return null;
  }
  const notes = picked.filter((i) => i.kind === "note");
  const style = notes.length === picked.length ? notes[0]?.style : undefined;
  const only = picked.length === 1 ? picked[0] : null;
  const half = width / 2 + 8;
  const left = Math.max(
    half,
    Math.min(view.x + (box.x + box.w / 2) * view.s, size.w - half),
  );
  const above = view.y + box.y * view.s - 52;
  const top =
    above > 8
      ? above
      : Math.min(view.y + (box.y + box.h) * view.s + 12, size.h - 48);
  return (
    <div
      ref={ref}
      className="absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {style && (
        <>
          {PROJECT_NOTE_SIZES.map((s) => (
            <ToolbarButton
              key={s}
              label={`Size ${s.toUpperCase()}`}
              active={notes.every((n) => n.style?.size === s)}
              onClick={() => onStyle({ size: s })}
              className="w-8 text-xs font-semibold uppercase"
            >
              {s}
            </ToolbarButton>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          {PROJECT_NOTE_COLOURS.map((c) => (
            <ToolbarButton
              key={c}
              label={
                c === "none" ? "No card" : `${c[0].toUpperCase()}${c.slice(1)}`
              }
              active={notes.every((n) => n.style?.colour === c)}
              onClick={() => onStyle({ colour: c })}
              className="w-7 min-w-7 px-0"
            >
              <span
                className={cn(
                  "size-4 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20",
                  c === "none" &&
                    "bg-[linear-gradient(135deg,transparent_45%,hsl(var(--destructive))_45%,hsl(var(--destructive))_55%,transparent_55%)]",
                )}
                style={
                  c === "none" ? undefined : { background: NOTE_LOOK[c].swatch }
                }
              />
            </ToolbarButton>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        </>
      )}
      {only?.bookmarkId && (
        <ToolbarButton label="Open" onClick={() => onOpen(only.bookmarkId!)}>
          <ExternalLink className="size-4" />
        </ToolbarButton>
      )}
      {picked.length > 1 && (
        <ToolbarButton label="Tidy these up" onClick={onTidy}>
          <LayoutGrid className="size-4" />
        </ToolbarButton>
      )}
      <ToolbarButton label="Bring to front" onClick={onFront}>
        <ArrowUpToLine className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Send to back" onClick={onBack}>
        <ArrowDownToLine className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Take off the board (Delete)"
        onClick={onRemove}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </ToolbarButton>
    </div>
  );
}

/**
 * Fork: a project (/dashboard/projects/<id>) — its board: pictures from
 * your lists (and files from the computer) to move about, size and stack,
 * with notes and headings between them, its colours along the top. Saved
 * as you go; ⌘Z undoes.
 */
export default function ProjectBoard({ projectId }: { projectId: string }) {
  const api = useTRPC();
  const { data, error } = useQuery(
    api.projects.get.queryOptions({ projectId }),
  );
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-lg">This project isn&apos;t there any more.</p>
        <Link href="/dashboard/projects" className="text-sm underline">
          All projects
        </Link>
      </div>
    );
  }
  if (!data) {
    return <FullPageSpinner />;
  }
  return <Board key={projectId} projectId={projectId} data={data} />;
}

/** A project's board as the server sends it (projects.get). */
interface BoardData {
  project: ZProject;
  items: ZProjectItem[];
  bookmarks: ZBookmark[];
  sizes: Record<string, { w: number; h: number }>;
  colours: Record<string, { hex: string; share: number }[]>;
}

function Board({ projectId, data }: { projectId: string; data: BoardData }) {
  const router = useRouter();
  const isPhone = useIsPhone();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>(
    () => savedView(projectId) ?? { x: 0, y: 0, s: 1 },
  );
  const fitted = useRef(savedView(projectId) !== null);
  const { ref: fillRef, height } = useFillHeight();

  const board = useBoardState(projectId, data.items, {
    onArrived: (ids) => {
      setSelection(new Set(ids));
      rootFocus();
    },
  });
  const { items, current, commit } = board;

  const bookmarks = useMemo(
    () => new Map(data.bookmarks.map((b) => [b.id, b])),
    [data.bookmarks],
  );
  const placeholders = useMemo(
    () =>
      new Map(
        Object.entries(data.colours).flatMap(([id, colours]) =>
          colours[0] ? [[id, colours[0].hex] as const] : [],
        ),
      ),
    [data.colours],
  );
  const onBoard = useMemo(
    () =>
      new Set(
        Object.values(items).flatMap((i) =>
          i.bookmarkId ? [i.bookmarkId] : [],
        ),
      ),
    [items],
  );
  const palette = useMemo(
    () =>
      boardPalette(
        Object.values(items).flatMap((i) =>
          i.bookmarkId && data.colours[i.bookmarkId]
            ? [{ colours: data.colours[i.bookmarkId], area: i.w * i.h }]
            : [],
        ),
      ),
    [items, data.colours],
  );
  const counts = useMemo(() => {
    const all = Object.values(items);
    return {
      ...data.project,
      numPictures: all.filter((i) => i.kind === "bookmark").length,
      numNotes: all.filter((i) => i.kind === "note").length,
    };
  }, [items, data.project]);

  // Remember where the board was looked at.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(viewKey(projectId), JSON.stringify(view));
      } catch {
        // Not remembered: it opens showing everything.
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [projectId, view]);

  const showAll = useCallback(
    (within = size) => {
      if (!within) {
        return;
      }
      const box = boundsOf(Object.values(current.current));
      if (!box) {
        setView({ x: within.w / 2, y: within.h / 2, s: 1 });
        return;
      }
      const { x, y, scale } = fitView(box, within, { maxScale: 1 });
      setView({ x, y, s: scale });
    },
    [current, size],
  );

  // The first time it opens here, everything on it shows.
  useEffect(() => {
    if (size && !fitted.current) {
      fitted.current = true;
      showAll(size);
    }
  }, [size, showAll]);

  const middle = useCallback((): Point => {
    const s = size ?? { w: 800, h: 600 };
    return { x: (s.w / 2 - view.x) / view.s, y: (s.h / 2 - view.y) / view.s };
  }, [size, view]);

  const rootFocus = () =>
    document
      .querySelector<HTMLElement>(
        `[data-board="${projectId}"] [aria-label="Board"]`,
      )
      ?.focus({ preventScroll: true });

  const add = useAddToProject({
    quiet: true,
    onSuccess: (result) => {
      board.expectArrival(result.itemIds);
      if (result.itemIds.length === 0 && result.existingItemIds.length > 0) {
        setSelection(new Set(result.existingItemIds));
        sonner("Already on the board");
      }
      if (result.skipped > 0) {
        sonner(`${result.skipped} couldn't be added: they aren't yours`);
      }
    },
  });
  const upload = useUploadForBoard();

  const addNoteAt = useCallback(
    (at: Point, kind: "heading" | "text" | "sticky" = "text") => {
      const { style, w } = NOTE_KINDS[kind];
      const h =
        NOTE_FONT[style.size] * 1.25 + (style.colour === "none" ? 8 : 24);
      const id = nanoid();
      commit((all) =>
        liftToTop(
          {
            ...all,
            [id]: {
              id,
              kind: "note",
              bookmarkId: null,
              text: "",
              style,
              x: Math.round(at.x - w / 2),
              y: Math.round(at.y - h / 2),
              w,
              h,
              z: 0,
            },
          },
          [id],
        ),
      );
      setSelection(new Set([id]));
      setEditing(id);
    },
    [commit],
  );

  const removeSelected = useCallback(() => {
    if (selection.size === 0) {
      return;
    }
    commit((all) => {
      const next = { ...all };
      selection.forEach((id) => delete next[id]);
      return next;
    });
    setSelection(new Set());
  }, [commit, selection]);

  const tidyUp = useCallback(
    (ids?: ReadonlySet<string>) => {
      const all = Object.values(current.current);
      const chosen =
        ids && ids.size > 1 ? all.filter((i) => ids.has(i.id)) : all;
      if (chosen.length < 2) {
        return;
      }
      const placed = tidy(
        chosen.map((i) => ({
          ...i,
          heading: i.kind === "note" && i.style?.colour === "none",
          keepsShape: i.kind === "bookmark",
        })),
      );
      commit((now) => {
        const next = { ...now };
        for (const [id, box] of placed) {
          if (next[id]) {
            next[id] = { ...next[id], ...box };
          }
        }
        return next;
      });
    },
    [commit, current],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const s = size ?? { w: 800, h: 600 };
      setView((v) => zoomAround(v, v.s * factor, s.w / 2, s.h / 2));
    },
    [size],
  );

  const actions = useMemo<BoardActions>(
    () => ({
      openBookmark: (bookmarkId) =>
        router.push(`/dashboard/preview/${bookmarkId}`, { scroll: false }),
      addNoteAt,
      removeSelected,
      undo: board.undo,
      redo: board.redo,
      zoomBy,
      zoomTo: (s) => {
        const sz = size ?? { w: 800, h: 600 };
        setView((v) => zoomAround(v, s, sz.w / 2, sz.h / 2));
      },
      fit: () => showAll(),
      addBookmarksAt: (bookmarkIds, at) =>
        add.mutate({
          projectId,
          bookmarkIds,
          at,
          sizes: seenPictureSizes(bookmarkIds),
        }),
      addFilesAt: (files, at) => {
        void (async () => {
          const toastId = sonner.loading(
            files.length === 1 ? "Uploading it…" : `Uploading ${files.length}…`,
          );
          const ids: string[] = [];
          for (const file of files) {
            try {
              ids.push(await upload(file));
            } catch (e) {
              sonner.error(`${file.name}: couldn't upload it`, {
                description: e instanceof Error ? e.message : undefined,
              });
            }
          }
          sonner.dismiss(toastId);
          if (ids.length > 0) {
            add.mutate({ projectId, bookmarkIds: ids, at });
          }
        })();
      },
      editNote: (id, text) => {
        setEditing((was) => (was === id ? null : was));
        const note = current.current[id];
        if (!note) {
          return;
        }
        if (!text.trim()) {
          // A note left empty goes; an emptied one can be undone.
          commit((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setSelection((was) => {
            const next = new Set(was);
            next.delete(id);
            return next;
          });
          return;
        }
        if (text !== note.text) {
          commit((all) => ({ ...all, [id]: { ...all[id], text } }));
        }
      },
    }),
    [
      add,
      addNoteAt,
      board.redo,
      board.undo,
      commit,
      current,
      projectId,
      removeSelected,
      router,
      showAll,
      size,
      upload,
      zoomBy,
    ],
  );

  // Pictures pasted on the board (a screenshot, a copied picture) go on it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector("[role=dialog]")) {
        return;
      }
      const files = [...(e.clipboardData?.files ?? [])].filter(isBoardFile);
      if (files.length > 0) {
        e.preventDefault();
        actions.addFilesAt(files, middle());
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [actions, middle]);

  const picked = useMemo(
    () => [...selection].flatMap((id) => (items[id] ? [items[id]] : [])),
    [selection, items],
  );
  const empty = Object.keys(items).length === 0;

  return (
    <div
      ref={fillRef}
      data-board={projectId}
      className="flex flex-col gap-3"
      style={{ height: height ?? undefined }}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/dashboard/projects"
            title="All projects"
            aria-label="All projects"
            className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-2xl leading-tight">
              {data.project.name}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {projectSummary(counts)}
              {data.project.description ? ` · ${data.project.description}` : ""}
            </p>
          </div>
          {palette.length > 0 && (
            <div
              className="ml-2 hidden items-center gap-1 md:flex"
              aria-label="The board's colours"
            >
              {palette.map((hex) => (
                <Link
                  key={hex}
                  href={`/dashboard/colour/${hex.slice(1)}`}
                  title={hex}
                  className="size-5 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 dark:ring-white/15"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Undo (⌘Z)"
            aria-label="Undo"
            disabled={!board.canUndo}
            onClick={board.undo}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            disabled={!board.canRedo}
            onClick={board.redo}
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="gap-2"
            title="Lay everything out in neat columns"
            disabled={Object.keys(items).length < 2}
            onClick={() => tidyUp()}
          >
            <LayoutGrid className="size-4" />
            <span className="hidden lg:inline">Tidy up</span>
          </Button>
          {/* Not modal: a modal menu holds on to the keys while it closes,
              and the new words are already being written. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2" title="Add words">
                <Type className="size-4" />
                <span className="hidden lg:inline">Text</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // Nor does its button take them back.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem
                className="flex gap-2"
                onClick={() => addNoteAt(middle(), "heading")}
              >
                <Heading className="size-4" />
                <span>Heading</span>
                <span className="ml-auto pl-4 text-xs text-muted-foreground">
                  T
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex gap-2"
                onClick={() => addNoteAt(middle(), "text")}
              >
                <Type className="size-4" />
                <span>Text</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex gap-2"
                onClick={() => addNoteAt(middle(), "sticky")}
              >
                <StickyNote className="size-4" />
                <span>Sticky note</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            className="gap-2"
            variant={panelOpen ? "secondary" : "default"}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <ImagePlus className="size-4" />
            <span className="hidden sm:inline">Add pictures</span>
          </Button>
          <ProjectOptions
            project={counts}
            onBoard
            onDeleted={() => router.push("/dashboard/projects")}
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label="Project options"
              title="Project options"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </ProjectOptions>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-muted/30">
        <div className="relative min-w-0 flex-1">
          <BoardCanvas
            items={items}
            current={current}
            commit={commit}
            preview={board.preview}
            adjust={board.adjust}
            bookmarks={bookmarks}
            placeholders={placeholders}
            selection={selection}
            setSelection={setSelection}
            editing={editing}
            setEditing={setEditing}
            view={view}
            setView={setView}
            onSize={setSize}
            actions={actions}
            overlay={
              size &&
              !editing &&
              picked.length > 0 && (
                <SelectionToolbar
                  picked={picked}
                  view={view}
                  size={size}
                  onStyle={(style) =>
                    commit((all) => {
                      const next = { ...all };
                      for (const item of picked) {
                        if (item.kind === "note" && next[item.id]) {
                          next[item.id] = {
                            ...next[item.id],
                            style: { ...next[item.id].style!, ...style },
                          };
                        }
                      }
                      return next;
                    })
                  }
                  onOpen={actions.openBookmark}
                  onFront={() =>
                    commit((all) => liftToTop(all, [...selection]))
                  }
                  onBack={() =>
                    commit((all) => sinkToBottom(all, [...selection]))
                  }
                  onRemove={removeSelected}
                  onTidy={() => tidyUp(selection)}
                />
              )
            }
          />
          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border bg-background/90 p-6 text-center shadow-sm backdrop-blur">
                <p className="font-medium">An empty board</p>
                <p className="text-sm text-muted-foreground">
                  Bring pictures in from your lists, drop files from your
                  computer, or paste one. Double-click anywhere to write.
                </p>
                <Button className="gap-2" onClick={() => setPanelOpen(true)}>
                  <ImagePlus className="size-4" />
                  Add pictures
                </Button>
              </div>
            </div>
          )}
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-1 text-popover-foreground shadow-sm backdrop-blur">
            <ToolbarButton
              label="Zoom out (−)"
              onClick={() => zoomBy(1 / 1.25)}
            >
              <Minus className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Actual size (0)"
              onClick={() => actions.zoomTo(1)}
              className="w-14 text-xs tabular-nums"
            >
              {Math.round(view.s * 100)}%
            </ToolbarButton>
            <ToolbarButton
              label="Zoom in (+)"
              onClick={() => zoomBy(Math.min(1.25, MAX_SCALE / view.s))}
            >
              <Plus className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Show everything (⇧1)"
              onClick={() => showAll()}
            >
              <Maximize className="size-4" />
            </ToolbarButton>
          </div>
        </div>
        {panelOpen && (
          <PicturePanel
            onBoard={onBoard}
            onAdd={(ids) => actions.addBookmarksAt(ids, middle())}
            onClose={() => setPanelOpen(false)}
            className={cn(
              "border-l",
              isPhone ? "absolute inset-0 z-30 border-l-0" : "w-80 shrink-0",
            )}
          />
        )}
      </div>
    </div>
  );
}
