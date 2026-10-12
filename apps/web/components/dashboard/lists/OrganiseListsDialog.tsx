"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isEmojiIcon } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
} from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  useBookmarkLists,
  useMoveBookmarkList,
} from "@karakeep/shared-react/hooks/lists";

type ListType = ZBookmarkList["type"];

/** A row's height, a level's indent and the grip's column, in pixels. */
const ROW = 36;
const INDENT = 20;
const GRIP = 28;

/**
 * Your lists of one kind as the sidebar shows them: a tree of their own, a
 * list under one of the other kind at the top.
 */
interface Section {
  /** Its parent as shown (null: at the top). */
  parentOf: (id: string) => string | null;
  /** The lists shown under one (null: at the top), first first. */
  childrenOf: (id: string | null) => ZBookmarkList[];
}

function sectionOf(lists: ZBookmarkList[], type: ListType): Section {
  const own = lists.filter((l) => l.userRole === "owner" && l.type === type);
  const ids = new Set(own.map((l) => l.id));
  const parents = new Map(
    own.map((l) => [
      l.id,
      l.parentId && ids.has(l.parentId) ? l.parentId : null,
    ]),
  );
  const children = new Map<string | null, ZBookmarkList[]>();
  for (const l of own) {
    const parent = parents.get(l.id) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), l]);
  }
  for (const kids of children.values()) {
    kids.sort((a, b) => b.position - a.position);
  }
  return {
    parentOf: (id) => parents.get(id) ?? null,
    childrenOf: (id) => children.get(id) ?? [],
  };
}

interface Row {
  list: ZBookmarkList;
  depth: number;
  hasChildren: boolean;
}

/** The rows shown: the tree, depth first, but for what's folded. */
function rowsOf(section: Section, folded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const list of section.childrenOf(parentId)) {
      if (seen.has(list.id)) {
        continue;
      }
      seen.add(list.id);
      const hasChildren = section.childrenOf(list.id).length > 0;
      rows.push({ list, depth, hasChildren });
      if (hasChildren && !folded.has(list.id)) {
        walk(list.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return rows;
}

/** Where a list goes: under a list (null: the top), between two shown. */
interface Place {
  parentId: string | null;
  above?: string;
  below?: string;
}

/**
 * What the pointer's over: a row (the list goes inside), a gap between two
 * rows (at a depth: after the list above, or after the list it's in, …) or
 * the top-level strip under the rows.
 */
type Target =
  | { kind: "inside"; row: number }
  | { kind: "gap"; gap: number; depth: number }
  | { kind: "top" };

/** The depths a list dropped in a gap can take (the rows above it: gap). */
function depthsAt(rows: Row[], gap: number): [number, number] {
  const up = rows[gap - 1];
  const down = rows[gap];
  if (!up) {
    return [0, 0];
  }
  // Between a list and its first sub-list: the first of them.
  if (down && down.depth > up.depth) {
    return [down.depth, down.depth];
  }
  return [down ? down.depth : 0, up.depth];
}

function placeOf(target: Target, rows: Row[], section: Section): Place {
  if (target.kind === "top") {
    return { parentId: null, above: section.childrenOf(null).at(-1)?.id };
  }
  if (target.kind === "inside") {
    const id = rows[target.row].list.id;
    return { parentId: id, above: section.childrenOf(id).at(-1)?.id };
  }
  const up = rows[target.gap - 1];
  const down = rows[target.gap];
  if (!up) {
    return { parentId: null, below: down?.list.id };
  }
  if (down && down.depth > up.depth) {
    return { parentId: up.list.id, below: down.list.id };
  }
  // Just after the list above, or the one it's in at that depth.
  let after = up.list.id;
  for (let depth = up.depth; depth > target.depth; depth--) {
    after = section.parentOf(after) ?? after;
  }
  const parentId = section.parentOf(after);
  const siblings = section.childrenOf(parentId);
  const i = siblings.findIndex((l) => l.id === after);
  return { parentId, above: after, below: siblings[i + 1]?.id };
}

/** Whether `id` is `listId` or under it (a list can't go in there). */
function isWithin(
  byId: Map<string, ZBookmarkList>,
  id: string | null,
  listId: string,
) {
  for (
    let at = id, n = 0;
    at && n < 1000;
    at = byId.get(at)?.parentId ?? null
  ) {
    if (at === listId) {
      return true;
    }
    n++;
  }
  return false;
}

/** Its siblings under a list, first first, as the server has them. */
function siblingsOf(
  lists: ZBookmarkList[],
  parentId: string | null,
  without: string,
) {
  return lists
    .filter(
      (l) =>
        l.userRole === "owner" && l.parentId === parentId && l.id !== without,
    )
    .sort((a, b) => b.position - a.position);
}

/**
 * The place as lists.move's index: among all its new siblings (those of the
 * other kind too) — just above the one shown below it, else just below the
 * one above.
 */
function indexOf(lists: ZBookmarkList[], listId: string, place: Place) {
  const siblings = siblingsOf(lists, place.parentId, listId);
  const at = (id?: string) =>
    id === undefined ? -1 : siblings.findIndex((l) => l.id === id);
  if (at(place.below) >= 0) {
    return at(place.below);
  }
  if (at(place.above) >= 0) {
    return at(place.above) + 1;
  }
  return place.above === undefined ? 0 : siblings.length;
}

interface Drag {
  listId: string;
  pointerId: number;
  /** The row's depth when picked up. */
  depth: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Past the few pixels that make a press a drag. */
  moving: boolean;
  target: Target | null;
}

type Part = "grip" | "up" | "down" | "in" | "out";

function RowButton({
  part,
  icon: Icon,
  label,
  onClick,
}: {
  part: Part;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-part={part}
      title={label}
      aria-label={label}
      disabled={!onClick}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon className="size-4" strokeWidth={1.5} />
    </button>
  );
}

/**
 * Fork: your lists as a tree, to put in order and in one another — dragged
 * (by the row with a mouse, by its grip on a touch screen): between two
 * rows to go there (further left or right for the depth, where there's a
 * choice), onto one to go inside it, or onto the strip under them for the
 * top level. Each row's arrows (and the arrow keys on its grip) move it up
 * or down, into the list above or out of the one it's in. Lists and smart
 * lists each have their tree, as in the sidebar.
 */
export function OrganiseListsDialog({
  type = "manual",
  children,
}: {
  /** The tree shown first. */
  type?: ListType;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ListType>(type);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ id: string; part: Part } | null>(null);

  const { data } = useBookmarkLists(undefined, { enabled: open });
  const lists = useMemo(() => data?.data ?? [], [data]);
  const byId = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const section = useMemo(() => sectionOf(lists, tab), [lists, tab]);
  const rows = useMemo(() => rowsOf(section, folded), [section, folded]);
  const { mutate: moveList } = useMoveBookmarkList();

  const update = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setTab(type);
      setFolded(new Set());
      setSelected(null);
    }
    update(null);
    setOpen(next);
  };

  /** Where a place puts the list; null where it can't go or wouldn't move. */
  const resolve = (listId: string, place: Place) => {
    const list = byId.get(listId);
    if (!list || place.above === listId || place.below === listId) {
      return null;
    }
    if (isWithin(byId, place.parentId, listId)) {
      return null;
    }
    const index = indexOf(lists, listId, place);
    const now = siblingsOf(lists, list.parentId, listId).filter(
      (l) => l.position > list.position,
    ).length;
    if (list.parentId === place.parentId && index === now) {
      return null;
    }
    return index;
  };

  const put = (listId: string, place: Place, focus?: Part) => {
    const index = resolve(listId, place);
    if (index === null) {
      return;
    }
    const { parentId } = place;
    // Where it went stays in view.
    if (parentId && folded.has(parentId)) {
      setFolded((was) => new Set([...was].filter((id) => id !== parentId)));
    }
    if (focus) {
      refocus.current = { id: listId, part: focus };
      setTimeout(() => {
        if (refocus.current?.id === listId) {
          refocus.current = null;
        }
      }, 1000);
    }
    moveList(
      { listId, parentId, index },
      {
        onError: (e) =>
          toast({
            variant: "destructive",
            description: e.message || "The list couldn't be moved.",
          }),
      },
    );
  };

  /** A row's moves: up, down, into the list above, out of its own. */
  const movesOf = (list: ZBookmarkList) => {
    const parentId = section.parentOf(list.id);
    const siblings = section.childrenOf(parentId);
    const i = siblings.findIndex((l) => l.id === list.id);
    const prev = siblings[i - 1];
    const next = siblings[i + 1];
    let out: Place | undefined;
    if (parentId) {
      const grandparent = section.parentOf(parentId);
      const around = section.childrenOf(grandparent);
      const at = around.findIndex((l) => l.id === parentId);
      out = {
        parentId: grandparent,
        above: parentId,
        below: around[at + 1]?.id,
      };
    }
    return {
      up: prev && {
        parentId,
        above: siblings[i - 2]?.id,
        below: prev.id,
      },
      down: next && { parentId, above: next.id, below: siblings[i + 2]?.id },
      in: prev && {
        parentId: prev.id,
        above: section.childrenOf(prev.id).at(-1)?.id,
      },
      out,
      prev,
      parent: parentId ? byId.get(parentId) : undefined,
    };
  };

  /** What's under the pointer. */
  const targetAt = (d: Drag): Target | null => {
    const top = topRef.current?.getBoundingClientRect();
    if (top && d.y >= top.top && d.y <= top.bottom) {
      return { kind: "top" };
    }
    const box = listRef.current?.getBoundingClientRect();
    if (!box || rows.length === 0) {
      return null;
    }
    // Where there's a choice: a level's indent left or right of where it
    // was picked up is a level out or in.
    const depthIn = (gap: number) => {
      const [min, max] = depthsAt(rows, gap);
      const wanted = d.depth + Math.trunc((d.x - d.startX) / INDENT);
      return Math.max(min, Math.min(max, wanted));
    };
    const y = d.y - box.top;
    if (y < 0) {
      return { kind: "gap", gap: 0, depth: 0 };
    }
    if (y >= rows.length * ROW) {
      return { kind: "gap", gap: rows.length, depth: depthIn(rows.length) };
    }
    const row = Math.floor(y / ROW);
    const within = y / ROW - row;
    if (within < 0.25) {
      return { kind: "gap", gap: row, depth: depthIn(row) };
    }
    if (within > 0.75) {
      return { kind: "gap", gap: row + 1, depth: depthIn(row + 1) };
    }
    return { kind: "inside", row };
  };

  const dropAt = (d: Drag) => {
    if (d.moving && d.target) {
      put(d.listId, placeOf(d.target, rows, section));
    }
  };

  // The window's events reach the latest of these.
  const handlers = useRef({ targetAt, dropAt });
  useLayoutEffect(() => {
    handlers.current = { targetAt, dropAt };
  });

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) {
        return;
      }
      // Let go outside the window.
      if (e.pointerType === "mouse" && e.buttons === 0) {
        update(null);
        return;
      }
      const moving =
        d.moving || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4;
      const next = { ...d, x: e.clientX, y: e.clientY, moving };
      next.target = moving ? handlers.current.targetAt(next) : null;
      update(next);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) {
        return;
      }
      update(null);
      handlers.current.dropAt(d);
    };
    const onCancel = () => update(null);
    // Before the dialog's own Escape: that closes it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        update(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [dragging, update]);

  // Near the top or bottom edge, the rows scroll (not over the top-level
  // strip under them).
  useEffect(() => {
    if (!dragging) {
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      const d = dragRef.current;
      const scroller = scrollRef.current;
      if (d?.moving && scroller) {
        const box = scroller.getBoundingClientRect();
        const edge = 32;
        const by =
          d.y < box.top + edge
            ? -(box.top + edge - d.y)
            : d.y > box.bottom - edge && d.y < box.bottom + 8
              ? d.y - (box.bottom - edge)
              : 0;
        if (by !== 0) {
          const was = scroller.scrollTop;
          scroller.scrollTop += Math.max(-12, Math.min(12, by / 3));
          if (scroller.scrollTop !== was) {
            update({ ...d, target: handlers.current.targetAt(d) });
          }
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [dragging, update]);

  // Resting on a folded list unfolds it, so it can be dropped in between.
  const restingOn =
    drag?.moving && drag.target?.kind === "inside"
      ? rows[drag.target.row]?.list.id
      : undefined;
  useEffect(() => {
    if (!restingOn || !folded.has(restingOn)) {
      return;
    }
    const timer = setTimeout(
      () =>
        setFolded((was) => new Set([...was].filter((id) => id !== restingOn))),
      600,
    );
    return () => clearTimeout(timer);
  }, [restingOn, folded]);

  // Rows glide to where they've moved; a moved row keeps the focus.
  const shownAt = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const before = shownAt.current;
    const now = new Map(rows.map((r, i) => [r.list.id, i]));
    shownAt.current = now;
    const el = listRef.current;
    if (!el) {
      return;
    }
    const want = refocus.current;
    if (want) {
      const row = el.querySelector(`[data-row="${CSS.escape(want.id)}"]`);
      const button =
        row?.querySelector<HTMLButtonElement>(
          `[data-part="${want.part}"]:not(:disabled)`,
        ) ?? row?.querySelector<HTMLButtonElement>('[data-part="grip"]');
      if (button && document.activeElement !== button) {
        button.focus();
      }
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    for (const li of el.querySelectorAll<HTMLElement>("[data-row]")) {
      const from = before.get(li.dataset.row ?? "");
      const to = now.get(li.dataset.row ?? "");
      if (from !== undefined && to !== undefined && from !== to) {
        li.animate(
          [
            { transform: `translateY(${(from - to) * ROW}px)` },
            { transform: "none" },
          ],
          { duration: 180, easing: "ease-out" },
        );
      }
    }
  }, [rows]);

  // What a drag shows: the list (and what's in it) faded, and where it'd
  // land — a line in a gap, a ring round a row, the top-level strip lit.
  const moving = drag?.moving ? drag : null;
  const from = moving ? rows.findIndex((r) => r.list.id === moving.listId) : -1;
  let to = from;
  while (from >= 0 && rows[to + 1] && rows[to + 1].depth > rows[from].depth) {
    to++;
  }
  const landing =
    moving?.target &&
    resolve(moving.listId, placeOf(moving.target, rows, section)) !== null
      ? moving.target
      : null;
  const dragged = moving ? byId.get(moving.listId) : undefined;
  const countUnder = (id: string, depth = 0): number =>
    depth > 50
      ? 0
      : section
          .childrenOf(id)
          .reduce((n, l) => n + 1 + countUnder(l.id, depth + 1), 0);
  const carried = moving ? countUnder(moving.listId) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        // Held at the top, not centred: a list unfolding (a drag resting on
        // it) grows it downwards, the rows staying under the pointer.
        className={cn(
          "top-[10vh] flex max-h-[80vh] translate-y-0 flex-col gap-4",
          moving && "cursor-grabbing [&_*]:cursor-grabbing",
        )}
        onEscapeKeyDown={(e) => dragRef.current && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Organise lists</DialogTitle>
          <DialogDescription>
            Drag a list between others to move it, or onto one to put it inside.
            The arrows on a row do the same.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            update(null);
            setSelected(null);
            setTab(value as ListType);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full shrink-0 grid-cols-2">
            <TabsTrigger value="manual">Lists</TabsTrigger>
            <TabsTrigger value="smart">Smart lists</TabsTrigger>
          </TabsList>
          <TabsContent
            ref={scrollRef}
            value={tab}
            className="-mx-2 mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          >
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {tab === "smart" ? "No smart lists yet." : "No lists yet."}
              </p>
            ) : (
              <ul ref={listRef} className="relative select-none">
                {rows.map((row, i) => {
                  const { list } = row;
                  const moves = movesOf(list);
                  const act = (part: Part, place?: Place) =>
                    place && (() => put(list.id, place, part));
                  const open = row.hasChildren && !folded.has(list.id);
                  const dim = from >= 0 && i >= from && i <= to;
                  const ringed =
                    landing?.kind === "inside" && landing.row === i;
                  const fold = () =>
                    setFolded((was) => {
                      const next = new Set(was);
                      if (open) {
                        next.add(list.id);
                      } else {
                        next.delete(list.id);
                      }
                      return next;
                    });
                  return (
                    <li
                      key={list.id}
                      data-row={list.id}
                      style={{ height: ROW }}
                      className={cn(
                        "group relative flex items-center rounded-md pr-1 transition-colors",
                        !moving && "hover:bg-muted/60",
                        selected === list.id && !moving && "bg-muted/60",
                        dim && "opacity-40",
                        ringed &&
                          "bg-primary/10 ring-1 ring-inset ring-primary",
                      )}
                      onPointerDown={(e) => {
                        if (e.button !== 0 || dragRef.current) {
                          return;
                        }
                        const el = e.target as HTMLElement;
                        const onGrip = !!el.closest('[data-part="grip"]');
                        // A mouse drags by the row, a finger by the grip
                        // (the row scrolls).
                        if (
                          !onGrip &&
                          (e.pointerType !== "mouse" || el.closest("button"))
                        ) {
                          return;
                        }
                        update({
                          listId: list.id,
                          pointerId: e.pointerId,
                          depth: row.depth,
                          startX: e.clientX,
                          startY: e.clientY,
                          x: e.clientX,
                          y: e.clientY,
                          moving: false,
                          target: null,
                        });
                      }}
                      // A tap shows a row's arrows (a touch screen has no
                      // hover).
                      onPointerUp={(e) => {
                        const el = e.target as HTMLElement;
                        if (
                          !dragRef.current?.moving &&
                          !el.closest("button:not([data-part=grip])")
                        ) {
                          setSelected((was) =>
                            was === list.id ? null : list.id,
                          );
                        }
                      }}
                    >
                      <button
                        type="button"
                        data-part="grip"
                        aria-label={`Move ${list.name}`}
                        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                        title="Drag, or use the arrow keys"
                        onKeyDown={(e) => {
                          const place = {
                            ArrowUp: moves.up,
                            ArrowDown: moves.down,
                            ArrowRight: moves.in,
                            ArrowLeft: moves.out,
                          }[e.key];
                          if (e.key.startsWith("Arrow")) {
                            e.preventDefault();
                          }
                          if (place) {
                            put(list.id, place, "grip");
                          }
                        }}
                        style={{ width: GRIP }}
                        className="flex h-full shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <GripVertical className="size-4" strokeWidth={1.5} />
                      </button>
                      <span
                        aria-hidden
                        className="shrink-0"
                        style={{ width: row.depth * INDENT }}
                      />
                      {row.hasChildren ? (
                        <button
                          type="button"
                          onClick={fold}
                          aria-expanded={open}
                          aria-label={`${open ? "Fold" : "Unfold"} ${list.name}`}
                          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronRight
                            className={cn(
                              "size-4 transition-transform",
                              open && "rotate-90",
                            )}
                          />
                        </button>
                      ) : (
                        <span aria-hidden className="w-6 shrink-0" />
                      )}
                      {isEmojiIcon(list.icon) && (
                        <span className="mr-2 text-base leading-none">
                          {list.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {list.name}
                      </span>
                      <div
                        className={cn(
                          "flex shrink-0 items-center transition-opacity",
                          moving
                            ? "invisible"
                            : selected === list.id
                              ? "opacity-100"
                              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
                        )}
                      >
                        <RowButton
                          part="up"
                          icon={ArrowUp}
                          label="Move up"
                          onClick={act("up", moves.up)}
                        />
                        <RowButton
                          part="down"
                          icon={ArrowDown}
                          label="Move down"
                          onClick={act("down", moves.down)}
                        />
                        <RowButton
                          part="in"
                          icon={IndentIncrease}
                          label={
                            moves.prev
                              ? `Into ${moves.prev.name}`
                              : "Into the list above"
                          }
                          onClick={act("in", moves.in)}
                        />
                        <RowButton
                          part="out"
                          icon={IndentDecrease}
                          label={
                            moves.parent
                              ? `Out of ${moves.parent.name}`
                              : "Out of the list it's in"
                          }
                          onClick={act("out", moves.out)}
                        />
                      </div>
                    </li>
                  );
                })}
                {landing?.kind === "gap" && (
                  <li
                    aria-hidden
                    className="pointer-events-none absolute right-1 z-10 h-0.5 rounded-full bg-primary"
                    style={{
                      top: landing.gap * ROW - 1,
                      left: GRIP + landing.depth * INDENT + 4,
                    }}
                  >
                    <span className="absolute -left-1 -top-[3px] size-2 rounded-full border-2 border-primary bg-background" />
                  </li>
                )}
              </ul>
            )}
          </TabsContent>
        </Tabs>
        {/* While a list's dragged, the strip for the top level takes the
            footer's place (the same height: nothing jumps). */}
        {moving ? (
          <div
            ref={topRef}
            className={cn(
              "flex h-10 shrink-0 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground transition-colors",
              landing?.kind === "top" &&
                "border-primary bg-primary/10 text-foreground",
            )}
          >
            Drop here for the top level
          </div>
        ) : (
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        )}
        {moving &&
          dragged &&
          createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 z-[100] flex max-w-64 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-lg"
              style={{
                transform: `translate(${moving.x + 14}px, ${moving.y + 10}px)`,
              }}
            >
              {isEmojiIcon(dragged.icon) && <span>{dragged.icon}</span>}
              <span className="truncate">{dragged.name}</span>
              {carried > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                  +{carried}
                </span>
              )}
            </div>,
            document.body,
          )}
      </DialogContent>
    </Dialog>
  );
}
