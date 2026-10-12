"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { draggedBookmarkIds, isBookmarkDrag } from "@/lib/bookmark-drag";
import { cn } from "@/lib/utils";

import type { Point, Rect } from "@karakeep/shared/projectLayout";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { ZProjectItem } from "@karakeep/shared/types/projects";
import { boundsOf, intersects } from "@karakeep/shared/projectLayout";

import type { Items } from "./useBoardState";
import { BoardItem } from "./BoardItem";
import { isBoardFile } from "./boardPictures";

/** What the board shows: its offset on screen and its zoom. */
export interface View {
  x: number;
  y: number;
  s: number;
}

/** What a note is made as (Text, the T key, a double-click). */
export type NoteKind = "heading" | "text" | "sticky";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;
/** A press that moves less than this is a click. */
const DRAG_SLOP = 3;
/** The dots' spacing, in board pixels. */
const GRID = 24;
/** How near (in screen pixels) an edge comes before it snaps to another. */
const SNAP = 6;
/** The camera is still this long after its last move. */
const SETTLE_MS = 160;
/** A mouse's pointer, for a press the browser gave no pointerdown for. */
const MOUSE_POINTER = 1;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const sameView = (a: View, b: View) =>
  a.x === b.x && a.y === b.y && a.s === b.s;

/** The view zoomed to `s`, the board point under (px, py) staying put. */
export function zoomAround(view: View, s: number, px: number, py: number) {
  const scale = clamp(s, MIN_SCALE, MAX_SCALE);
  const bx = (px - view.x) / view.s;
  const by = (py - view.y) / view.s;
  return { s: scale, x: px - bx * scale, y: py - by * scale };
}

/** The ids, stacked on top of everything else, keeping their own order. */
export function liftToTop(items: Items, ids: readonly string[]): Items {
  const all = Object.values(items).sort((a, b) => a.z - b.z);
  const lifting = new Set(ids);
  const top = all.slice(all.length - lifting.size);
  if (top.every((i) => lifting.has(i.id))) {
    return items;
  }
  let z = all.length > 0 ? all[all.length - 1].z : 0;
  const next = { ...items };
  for (const item of all.filter((i) => lifting.has(i.id))) {
    next[item.id] = { ...item, z: ++z };
  }
  return next;
}

/** The ids, under everything else. */
export function sinkToBottom(items: Items, ids: readonly string[]): Items {
  const all = Object.values(items).sort((a, b) => a.z - b.z);
  const sinking = new Set(ids);
  if (all.slice(0, sinking.size).every((i) => sinking.has(i.id))) {
    return items;
  }
  let z = all.length > 0 ? all[0].z : 0;
  const next = { ...items };
  for (const item of all.filter((i) => sinking.has(i.id)).reverse()) {
    next[item.id] = { ...item, z: --z };
  }
  return next;
}

/**
 * A mouse press that came without its pointerdown, as WebKit (Safari, the
 * Mac app) does for the first press after a drag and drop: the same press,
 * as the pointer handlers take it. (A pointerdown the board handled stops
 * the mouse events after it, so a press is never taken twice.)
 */
function asPointer(e: React.MouseEvent): React.PointerEvent {
  return Object.assign(Object.create(e) as React.PointerEvent, {
    pointerId: MOUSE_POINTER,
    pointerType: "mouse",
    stopPropagation: () => e.stopPropagation(),
    preventDefault: () => e.preventDefault(),
  });
}

interface Guide {
  /** "x": a vertical line at `at`; "y": a horizontal one. */
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/**
 * Where a box being moved snaps: its edges and middle to another's, when
 * one comes within SNAP screen pixels. The nudge to make, and the lines to
 * show.
 */
function snapBox(
  box: Rect,
  others: readonly Rect[],
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  let bestX: { d: number; at: number } | null = null;
  let bestY: { d: number; at: number } | null = null;
  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {
      for (const x of xs) {
        const d = ox - x;
        if (
          Math.abs(d) <= threshold &&
          (!bestX || Math.abs(d) < Math.abs(bestX.d))
        ) {
          bestX = { d, at: ox };
        }
      }
    }
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
      for (const y of ys) {
        const d = oy - y;
        if (
          Math.abs(d) <= threshold &&
          (!bestY || Math.abs(d) < Math.abs(bestY.d))
        ) {
          bestY = { d, at: oy };
        }
      }
    }
  }
  const dx = bestX?.d ?? 0;
  const dy = bestY?.d ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (bestX) {
    const at = bestX.at;
    const touching = others.filter((o) =>
      [o.x, o.x + o.w / 2, o.x + o.w].some((v) => near(v, at)),
    );
    const span = boundsOf([moved, ...touching]) ?? moved;
    guides.push({ axis: "x", at, from: span.y, to: span.y + span.h });
  }
  if (bestY) {
    const at = bestY.at;
    const touching = others.filter((o) =>
      [o.y, o.y + o.h / 2, o.y + o.h].some((v) => near(v, at)),
    );
    const span = boundsOf([moved, ...touching]) ?? moved;
    guides.push({ axis: "y", at, from: span.x, to: span.x + span.w });
  }
  return { dx, dy, guides };
}

type Corner = "nw" | "ne" | "sw" | "se";

type Gesture =
  | {
      kind: "move";
      pointerId: number;
      start: Point;
      base: Items;
      lifted: Items | null;
      ids: string[];
      moved: boolean;
      /** A click on a picked one with ⇧/⌘ held lets it go. */
      unpick: string | null;
    }
  | {
      kind: "resize";
      pointerId: number;
      id: string;
      corner: Corner;
      base: Items;
      anchor: Point;
    }
  | {
      kind: "marquee";
      pointerId: number;
      start: Point;
      picked: ReadonlySet<string>;
      moved: boolean;
    }
  | { kind: "pan"; pointerId: number; start: Point; view: View }
  | {
      kind: "pinch";
      ids: [number, number];
      startDistance: number;
      startMiddle: Point;
      view: View;
    };

export interface BoardActions {
  openBookmark: (bookmarkId: string) => void;
  /** A note whose words start at `at` (a click, a double-click). */
  addNoteAt: (at: Point, kind: NoteKind) => void;
  /** Text's tool: the next click on the board puts this kind there. */
  startPlacing: (kind: NoteKind) => void;
  stopPlacing: () => void;
  removeSelected: () => void;
  undo: () => void;
  redo: () => void;
  zoomBy: (factor: number) => void;
  zoomTo: (scale: number) => void;
  fit: () => void;
  addBookmarksAt: (bookmarkIds: string[], at: Point) => void;
  addFilesAt: (files: File[], at: Point) => void;
  editNote: (id: string, text: string) => void;
}

const PLACING_LABEL: Record<NoteKind, string> = {
  heading: "heading",
  text: "text",
  sticky: "sticky note",
};

/**
 * Fork: a project's board — an endless sheet of dots, its pictures and
 * notes where they were put. Moved about with two fingers (or the wheel),
 * zoomed with a pinch (or ⌘/Ctrl + wheel); space-drag or the middle button
 * pans, and so does a finger on an empty spot. Things are picked by a click
 * (⇧/⌘ adds), or by a box dragged round them; dragged to move, snapping to
 * their neighbours' edges and middles (⌥ holds it off); sized by a corner.
 * Pictures dragged from anywhere in vrana, or files from the computer, go
 * where they're dropped. With Text's tool on (`placing`), a click puts the
 * words there. ProjectBoard has the state and the actions.
 *
 * The camera (pan and zoom) is moved here, on the page itself, frame by
 * frame — not through React, which hears of it once it's still (`setView`)
 * — and the board is its own layer while it moves; what's drawn at the
 * board's scale (handles, guides, outlines) reads `--board-scale`.
 */
export function BoardCanvas({
  items,
  current,
  commit,
  preview,
  release,
  adjust,
  bookmarks,
  placeholders,
  selection,
  setSelection,
  editing,
  setEditing,
  view,
  camera,
  setView,
  onSize,
  actions,
  placing,
  overlay,
}: {
  items: Items;
  current: React.MutableRefObject<Items>;
  commit: (next: Items | ((items: Items) => Items), from?: Items) => void;
  preview: (next: Items) => void;
  /** A gesture is over: the board's state takes in what it held back. */
  release: () => void;
  adjust: (next: (items: Items) => Items) => void;
  bookmarks: ReadonlyMap<string, ZBookmark>;
  placeholders: ReadonlyMap<string, string>;
  selection: ReadonlySet<string>;
  setSelection: (selection: ReadonlySet<string>) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  /** Where the camera is, as set from outside (Fit, the zoom buttons). */
  view: View;
  /**
   * Where it is this moment: kept here as it moves (`view` follows once
   * it's still), for the page's own sums (the middle of the screen).
   */
  camera: React.MutableRefObject<View>;
  /** Told where the camera came to rest. */
  setView: (view: View) => void;
  onSize: (size: { w: number; h: number }) => void;
  actions: BoardActions;
  /** Text's tool: the next click puts this kind of note there. */
  placing: NoteKind | null;
  /** Drawn over the board, in screen space (the selection's toolbar). */
  overlay?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, Point>());
  const space = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dropping, setDropping] = useState(false);
  const dropDepth = useRef(0);
  const [menu, setMenu] = useState<{ x: number; y: number; at: Point } | null>(
    null,
  );
  // Something's being moved, sized or boxed: no toolbar over it.
  const [busy, setBusy] = useState(false);

  // The latest of everything, for handlers that outlive a render.
  const latest = useRef({ selection, editing, actions, placing, setView });
  latest.current = { selection, editing, actions, placing, setView };

  // ---- The camera ----------------------------------------------------------

  const viewRef = camera;
  const cameraFrame = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraMoving, setCameraMoving] = useState(false);
  const cameraMovingRef = useRef(false);

  /** The camera, onto the page: the board's place and scale, the dots. */
  const paint = useCallback(() => {
    cameraFrame.current = 0;
    const v = viewRef.current;
    const world = worldRef.current;
    const root = rootRef.current;
    if (!world || !root) {
      return;
    }
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    world.style.setProperty("--board-scale", String(v.s));
    const step = GRID * v.s * (v.s < 0.35 ? 4 : v.s < 0.7 ? 2 : 1);
    root.style.backgroundSize = `${step}px ${step}px`;
    root.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }, []);

  /** Moves the camera now, and tells the page once it's still. */
  const moveCamera = useCallback(
    (next: View | ((v: View) => View)) => {
      const v = typeof next === "function" ? next(viewRef.current) : next;
      if (sameView(v, viewRef.current)) {
        return;
      }
      viewRef.current = v;
      if (!cameraFrame.current) {
        cameraFrame.current = requestAnimationFrame(paint);
      }
      if (!cameraMovingRef.current) {
        cameraMovingRef.current = true;
        setCameraMoving(true);
      }
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        if (cameraFrame.current) {
          cancelAnimationFrame(cameraFrame.current);
          paint();
        }
        cameraMovingRef.current = false;
        setCameraMoving(false);
        latest.current.setView(viewRef.current);
      }, SETTLE_MS);
    },
    [paint],
  );

  // Set from outside (Fit, the zoom buttons, where it was last time).
  useLayoutEffect(() => {
    if (!sameView(view, viewRef.current)) {
      viewRef.current = view;
      paint();
    }
  }, [view, paint]);
  useLayoutEffect(() => {
    paint();
    return () => {
      if (cameraFrame.current) {
        cancelAnimationFrame(cameraFrame.current);
      }
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
    };
  }, [paint]);

  // Where on the board a point on screen is.
  const toBoard = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (clientX - (rect?.left ?? 0) - v.x) / v.s,
      y: (clientY - (rect?.top ?? 0) - v.y) / v.s,
    };
  }, []);
  const local = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() =>
      onSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onSize]);

  // In stacking order; ranks for z-index.
  const ordered = useMemo(
    () =>
      Object.values(items).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)),
    [items],
  );

  // ---- Pointer gestures ------------------------------------------------

  const pending = useRef<PointerEvent | null>(null);
  const frame = useRef(0);

  const handleMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) {
        return;
      }
      const v = viewRef.current;
      switch (g.kind) {
        case "move": {
          if (e.pointerId !== g.pointerId) {
            return;
          }
          const sx = e.clientX - g.start.x;
          const sy = e.clientY - g.start.y;
          if (!g.moved && Math.hypot(sx, sy) < DRAG_SLOP) {
            return;
          }
          if (!g.moved) {
            g.moved = true;
            g.lifted = liftToTop(g.base, g.ids);
            setBusy(true);
          }
          const lifted = g.lifted ?? g.base;
          let dx = sx / v.s;
          let dy = sy / v.s;
          const moving = g.ids.flatMap((id) =>
            lifted[id] ? [lifted[id]] : [],
          );
          const box = boundsOf(moving);
          let shown: Guide[] = [];
          if (box && !e.altKey) {
            const movingIds = new Set(g.ids);
            const others = Object.values(lifted).filter(
              (i) => !movingIds.has(i.id),
            );
            const snapped = snapBox(
              { ...box, x: box.x + dx, y: box.y + dy },
              others,
              SNAP / v.s,
            );
            dx += snapped.dx;
            dy += snapped.dy;
            shown = snapped.guides;
          }
          setGuides(shown);
          const next = { ...lifted };
          for (const item of moving) {
            next[item.id] = { ...item, x: item.x + dx, y: item.y + dy };
          }
          preview(next);
          return;
        }
        case "resize": {
          if (e.pointerId !== g.pointerId) {
            return;
          }
          const item = g.base[g.id];
          if (!item) {
            return;
          }
          const p = toBoard(e.clientX, e.clientY);
          const west = g.corner === "nw" || g.corner === "sw";
          const north = g.corner === "nw" || g.corner === "ne";
          let w: number;
          let h: number;
          if (item.kind === "note") {
            w = Math.max(60, west ? g.anchor.x - p.x : p.x - g.anchor.x);
            h = item.h;
          } else {
            const aspect = item.h / item.w;
            w = Math.max(
              24,
              west ? g.anchor.x - p.x : p.x - g.anchor.x,
              (north ? g.anchor.y - p.y : p.y - g.anchor.y) / aspect,
            );
            h = w * aspect;
          }
          const x = west ? g.anchor.x - w : g.anchor.x;
          const y =
            item.kind === "note" ? item.y : north ? g.anchor.y - h : g.anchor.y;
          preview({ ...g.base, [g.id]: { ...item, x, y, w, h } });
          return;
        }
        case "marquee": {
          if (e.pointerId !== g.pointerId) {
            return;
          }
          if (
            !g.moved &&
            Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_SLOP
          ) {
            return;
          }
          if (!g.moved) {
            g.moved = true;
            setBusy(true);
          }
          const a = local(g.start.x, g.start.y);
          const b = local(e.clientX, e.clientY);
          const rect = {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x),
            h: Math.abs(a.y - b.y),
          };
          setMarquee(rect);
          const area = {
            x: (rect.x - v.x) / v.s,
            y: (rect.y - v.y) / v.s,
            w: rect.w / v.s,
            h: rect.h / v.s,
          };
          const hit = Object.values(current.current)
            .filter((i) => intersects(i, area))
            .map((i) => i.id);
          setSelection(new Set([...g.picked, ...hit]));
          return;
        }
        case "pan": {
          if (e.pointerId !== g.pointerId) {
            return;
          }
          moveCamera({
            ...g.view,
            x: g.view.x + e.clientX - g.start.x,
            y: g.view.y + e.clientY - g.start.y,
          });
          return;
        }
        case "pinch": {
          const [a, b] = g.ids.map((id) => touches.current.get(id));
          if (!a || !b) {
            return;
          }
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const middle = local((a.x + b.x) / 2, (a.y + b.y) / 2);
          const scale = clamp(
            (g.view.s * distance) / Math.max(1, g.startDistance),
            MIN_SCALE,
            MAX_SCALE,
          );
          const bx = (g.startMiddle.x - g.view.x) / g.view.s;
          const by = (g.startMiddle.y - g.view.y) / g.view.s;
          moveCamera({
            s: scale,
            x: middle.x - bx * scale,
            y: middle.y - by * scale,
          });
          return;
        }
      }
    },
    [current, local, moveCamera, preview, setSelection, toBoard],
  );

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      if (touches.current.has(e.pointerId)) {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      pending.current = e;
      if (!frame.current) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const latestEvent = pending.current;
          pending.current = null;
          if (latestEvent) {
            handleMove(latestEvent);
          }
        });
      }
    },
    [handleMove],
  );

  const stopListening = useRef<() => void>(() => undefined);

  /** Every gesture's end: the board takes in what it held back. */
  const finish = useCallback(() => {
    gesture.current = null;
    setGuides([]);
    setMarquee(null);
    setPanning(false);
    setBusy(false);
    stopListening.current();
    release();
  }, [release]);

  const onWindowUp = useCallback(
    (e: PointerEvent) => {
      touches.current.delete(e.pointerId);
      const g = gesture.current;
      if (!g) {
        finish();
        return;
      }
      if (g.kind === "pinch") {
        if (!g.ids.includes(e.pointerId)) {
          return;
        }
        // The other finger carries on panning.
        const [left] = [...touches.current.entries()];
        if (left) {
          gesture.current = {
            kind: "pan",
            pointerId: left[0],
            start: left[1],
            view: viewRef.current,
          };
        } else {
          finish();
        }
        return;
      }
      if (e.pointerId !== g.pointerId) {
        return;
      }
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        if (pending.current) {
          handleMove(pending.current);
          pending.current = null;
        }
      }
      if (g.kind === "move") {
        if (g.moved) {
          commit(current.current, g.base);
        } else if (g.unpick) {
          const next = new Set(latest.current.selection);
          next.delete(g.unpick);
          setSelection(next);
        }
      } else if (g.kind === "resize" && current.current !== g.base) {
        commit(current.current, g.base);
      }
      finish();
    },
    [commit, current, finish, handleMove, setSelection],
  );

  const listen = useCallback(() => {
    stopListening.current();
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
    stopListening.current = () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
      stopListening.current = () => undefined;
    };
  }, [onWindowMove, onWindowUp]);

  useEffect(() => () => stopListening.current(), []);

  /** A second finger down: whatever the first was doing becomes a pinch. */
  const startPinchIfTwo = useCallback(() => {
    if (touches.current.size !== 2) {
      return false;
    }
    const g = gesture.current;
    if ((g?.kind === "move" && g.moved) || g?.kind === "resize") {
      preview(g.base);
    }
    const [[ida, a], [idb, b]] = [...touches.current.entries()];
    gesture.current = {
      kind: "pinch",
      ids: [ida, idb],
      startDistance: Math.hypot(a.x - b.x, a.y - b.y),
      startMiddle: local((a.x + b.x) / 2, (a.y + b.y) / 2),
      view: viewRef.current,
    };
    setGuides([]);
    setBusy(true);
    listen();
    return true;
  }, [listen, local, preview]);

  const startPan = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      gesture.current = {
        kind: "pan",
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        view: viewRef.current,
      };
      setPanning(true);
      setBusy(true);
      listen();
    },
    [listen],
  );

  /** Text's tool on: the press puts the words there, and that's all it does. */
  const placeAt = useCallback(
    (e: React.PointerEvent) => {
      const kind = latest.current.placing;
      if (!kind) {
        return false;
      }
      e.stopPropagation();
      e.preventDefault();
      if (e.button === 0) {
        latest.current.actions.addNoteAt(toBoard(e.clientX, e.clientY), kind);
      }
      latest.current.actions.stopPlacing();
      return true;
    },
    [toBoard],
  );

  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, item: ZProjectItem) => {
      setMenu(null);
      if (placeAt(e)) {
        return;
      }
      if (e.button === 2 || latest.current.editing === item.id) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      // No mouse events after it (nor the page's text selection): the
      // board takes it from here.
      e.preventDefault();
      rootRef.current?.focus({ preventScroll: true });
      if (e.pointerType === "touch") {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (startPinchIfTwo()) {
          return;
        }
      }
      if (e.button === 1 || space.current) {
        startPan(e);
        return;
      }
      if (latest.current.editing) {
        setEditing(null);
      }
      const picked = latest.current.selection;
      const adding = e.shiftKey || e.metaKey || e.ctrlKey;
      let next = picked;
      let unpick: string | null = null;
      if (adding) {
        if (picked.has(item.id)) {
          unpick = item.id;
        } else {
          next = new Set([...picked, item.id]);
        }
      } else if (!picked.has(item.id)) {
        next = new Set([item.id]);
      }
      if (next !== picked) {
        setSelection(next);
      }
      gesture.current = {
        kind: "move",
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        base: current.current,
        lifted: null,
        ids: [...next],
        moved: false,
        unpick,
      };
      listen();
    },
    [
      current,
      listen,
      placeAt,
      setEditing,
      setSelection,
      startPan,
      startPinchIfTwo,
    ],
  );
  const onItemMouseDown = useCallback(
    (e: React.MouseEvent, item: ZProjectItem) =>
      onItemPointerDown(asPointer(e), item),
    [onItemPointerDown],
  );

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    setMenu(null);
    if (placeAt(e)) {
      return;
    }
    if (e.button === 2) {
      return;
    }
    e.preventDefault();
    rootRef.current?.focus({ preventScroll: true });
    if (latest.current.editing) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditing(null);
    }
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!startPinchIfTwo()) {
        startPan(e);
      }
      return;
    }
    if (e.button === 1 || space.current) {
      startPan(e);
      return;
    }
    if (e.button !== 0) {
      return;
    }
    const adding = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!adding) {
      setSelection(new Set());
    }
    gesture.current = {
      kind: "marquee",
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      picked: adding ? latest.current.selection : new Set(),
      moved: false,
    };
    listen();
  };

  const startResize = (e: React.PointerEvent, id: string, corner: Corner) => {
    e.stopPropagation();
    e.preventDefault();
    const item = current.current[id];
    if (!item || e.button !== 0) {
      return;
    }
    const west = corner === "nw" || corner === "sw";
    const north = corner === "nw" || corner === "ne";
    gesture.current = {
      kind: "resize",
      pointerId: e.pointerId,
      id,
      corner,
      base: current.current,
      anchor: {
        x: west ? item.x + item.w : item.x,
        y: north ? item.y + item.h : item.y,
      },
    };
    setBusy(true);
    listen();
  };

  // ---- Wheel, pinch on a trackpad --------------------------------------

  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    let gestureScale: number | null = null;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) {
        return;
      }
      // A note being written scrolls itself.
      if (e.target instanceof HTMLTextAreaElement) {
        return;
      }
      e.preventDefault();
      setMenu(null);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const p = local(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey) {
        if (gestureScale !== null) {
          return;
        }
        const factor = Math.exp(-e.deltaY * unit * 0.01);
        moveCamera((v) => zoomAround(v, v.s * factor, p.x, p.y));
      } else {
        moveCamera((v) => ({
          ...v,
          x: v.x - e.deltaX * unit,
          y: v.y - e.deltaY * unit,
        }));
      }
    };
    // Safari (and the Mac app) pinch with gesture events.
    type GestureEvent = UIEvent & {
      scale: number;
      clientX: number;
      clientY: number;
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = viewRef.current.s;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (gestureScale === null) {
        return;
      }
      const p = local(g.clientX, g.clientY);
      const from = gestureScale;
      moveCamera((v) => zoomAround(v, from * g.scale, p.x, p.y));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [local, moveCamera]);

  // ---- Keys ---------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (latest.current.editing || e.target instanceof HTMLInputElement) {
      return;
    }
    const a = latest.current.actions;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const picked = latest.current.selection;
    if (e.key === " ") {
      e.preventDefault();
      if (!space.current) {
        space.current = true;
        setSpaceHeld(true);
      }
      return;
    }
    if (e.key === "Escape") {
      if (latest.current.placing) {
        a.stopPlacing();
      } else {
        setSelection(new Set());
      }
      setMenu(null);
    } else if (
      (e.key === "Backspace" || e.key === "Delete") &&
      picked.size > 0
    ) {
      e.preventDefault();
      a.removeSelected();
    } else if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        a.redo();
      } else {
        a.undo();
      }
    } else if (mod && key === "y") {
      e.preventDefault();
      a.redo();
    } else if (mod && key === "a") {
      e.preventDefault();
      setSelection(new Set(Object.keys(current.current)));
    } else if (e.key.startsWith("Arrow") && picked.size > 0 && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx =
        e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      commit((items) => {
        const next = { ...items };
        for (const id of picked) {
          if (next[id]) {
            next[id] = { ...next[id], x: next[id].x + dx, y: next[id].y + dy };
          }
        }
        return next;
      });
    } else if (e.key === "Enter" && picked.size === 1) {
      const [id] = picked;
      const item = current.current[id];
      if (item?.kind === "note") {
        e.preventDefault();
        setEditing(id);
      } else if (item?.bookmarkId) {
        e.preventDefault();
        a.openBookmark(item.bookmarkId);
      }
    } else if (!mod && !e.altKey && (key === "=" || key === "+")) {
      a.zoomBy(1.25);
    } else if (!mod && !e.altKey && key === "-") {
      a.zoomBy(0.8);
    } else if (
      !mod &&
      !e.altKey &&
      e.shiftKey &&
      (key === "!" || key === "1")
    ) {
      a.fit();
    } else if (!mod && !e.altKey && key === "0") {
      a.zoomTo(1);
    } else if (!mod && !e.altKey && key === "t") {
      e.preventDefault();
      a.startPlacing("heading");
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " ") {
      space.current = false;
      setSpaceHeld(false);
    }
  };

  // ---- Drops ------------------------------------------------------------

  const accepts = (e: React.DragEvent) =>
    !!e.dataTransfer &&
    (isBookmarkDrag(e) || [...e.dataTransfer.types].includes("Files"));

  const onDragEnter = (e: React.DragEvent) => {
    if (!accepts(e)) {
      return;
    }
    e.preventDefault();
    dropDepth.current++;
    setDropping(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!accepts(e)) {
      return;
    }
    dropDepth.current = Math.max(0, dropDepth.current - 1);
    if (dropDepth.current === 0) {
      setDropping(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    dropDepth.current = 0;
    setDropping(false);
    if (!accepts(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const at = toBoard(e.clientX, e.clientY);
    const ids = draggedBookmarkIds(e);
    if (ids.length > 0) {
      latest.current.actions.addBookmarksAt(ids, at);
      return;
    }
    const files = [...(e.dataTransfer.files ?? [])].filter(isBoardFile);
    if (files.length > 0) {
      latest.current.actions.addFilesAt(files, at);
    }
  };

  // ---- Items' own events --------------------------------------------------

  const onItemDoubleClick = useCallback(
    (e: React.MouseEvent, item: ZProjectItem) => {
      e.stopPropagation();
      if (item.kind === "note") {
        setSelection(new Set([item.id]));
        setEditing(item.id);
      } else if (item.bookmarkId) {
        latest.current.actions.openBookmark(item.bookmarkId);
      }
    },
    [setEditing, setSelection],
  );
  const onItemContextMenu = useCallback(
    (e: React.MouseEvent, item: ZProjectItem) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      if (latest.current.placing) {
        latest.current.actions.stopPlacing();
        return;
      }
      if (!latest.current.selection.has(item.id)) {
        setSelection(new Set([item.id]));
      }
    },
    [setSelection],
  );
  const onShape = useCallback(
    (item: ZProjectItem, w: number, h: number) => {
      adjust((all) => {
        const now = all[item.id];
        if (!now || now.kind !== "bookmark" || !(w > 0) || !(h > 0)) {
          return all;
        }
        const height = (now.w * h) / w;
        return Math.abs(height - now.h) <= 1
          ? all
          : { ...all, [item.id]: { ...now, h: height } };
      });
    },
    [adjust],
  );
  const onNoteHeight = useCallback(
    (item: ZProjectItem, h: number) => {
      if (!(h > 0)) {
        return;
      }
      adjust((all) => {
        const now = all[item.id];
        return !now || Math.abs(now.h - h) <= 0.5
          ? all
          : { ...all, [item.id]: { ...now, h } };
      });
    },
    [adjust],
  );
  const onNoteEdited = useCallback((item: ZProjectItem, text: string) => {
    latest.current.actions.editNote(item.id, text);
  }, []);

  // ---- Drawing ------------------------------------------------------------

  const single =
    selection.size === 1 && !editing ? items[[...selection][0]] : undefined;
  const pickedBox =
    selection.size > 1
      ? boundsOf([...selection].flatMap((id) => (items[id] ? [items[id]] : [])))
      : null;
  // Sizes on the board that stay the same on screen, whatever the zoom.
  const px = (n: number) => `calc(${n}px / var(--board-scale))`;
  const less = (at: number, n: number) =>
    `calc(${at}px - ${n}px / var(--board-scale))`;

  return (
    <div
      ref={rootRef}
      role="application"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the board takes keys of its own (Delete, ⌘Z, arrows)
      tabIndex={0}
      aria-label="Board"
      aria-roledescription="board"
      className={cn(
        "relative size-full touch-none select-none overflow-hidden outline-none",
        "[--board-dot:hsl(var(--foreground)/0.13)]",
        placing
          ? "cursor-crosshair [&_[data-board-item]]:!cursor-crosshair"
          : panning
            ? "cursor-grabbing"
            : spaceHeld
              ? "cursor-grab"
              : "cursor-default",
      )}
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--board-dot) 1px, transparent 1.2px)",
      }}
      onPointerDown={onBackgroundPointerDown}
      onMouseDown={(e) => onBackgroundPointerDown(asPointer(e))}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => {
        space.current = false;
        setSpaceHeld(false);
      }}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target === rootRef.current || target.dataset?.boardWorld) {
          actions.addNoteAt(toBoard(e.clientX, e.clientY), "text");
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (placing) {
          actions.stopPlacing();
          return;
        }
        const p = local(e.clientX, e.clientY);
        setMenu({ x: p.x, y: p.y, at: toBoard(e.clientX, e.clientY) });
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={worldRef}
        data-board-world="1"
        className="absolute left-0 top-0 origin-top-left"
        // Its own layer while the camera moves: no repainting the pictures.
        style={{ willChange: cameraMoving ? "transform" : undefined }}
      >
        {ordered.map((item, rank) => (
          <BoardItem
            key={item.id}
            item={item}
            bookmark={
              item.bookmarkId ? bookmarks.get(item.bookmarkId) : undefined
            }
            placeholder={
              item.bookmarkId ? placeholders.get(item.bookmarkId) : undefined
            }
            rank={rank + 1}
            selected={selection.has(item.id)}
            editing={editing === item.id}
            onPointerDown={onItemPointerDown}
            onMouseDown={onItemMouseDown}
            onDoubleClick={onItemDoubleClick}
            onContextMenu={onItemContextMenu}
            onShape={onShape}
            onNoteHeight={onNoteHeight}
            onNoteEdited={onNoteEdited}
          />
        ))}
        {pickedBox && (
          <div
            className="pointer-events-none absolute left-0 top-0 rounded-[4px] border-dashed border-primary/70"
            style={{
              transform: `translate(${less(pickedBox.x, 6)}, ${less(pickedBox.y, 6)})`,
              width: `calc(${pickedBox.w}px + 12px / var(--board-scale))`,
              height: `calc(${pickedBox.h}px + 12px / var(--board-scale))`,
              borderWidth: px(1),
              zIndex: ordered.length + 2,
            }}
          />
        )}
        {single &&
          (["nw", "ne", "sw", "se"] as const).map((corner) => {
            const x = corner.endsWith("w") ? single.x : single.x + single.w;
            const y = corner.startsWith("n") ? single.y : single.y + single.h;
            return (
              <div
                key={corner}
                aria-hidden
                data-board-handle={corner}
                onPointerDown={(e) => startResize(e, single.id, corner)}
                onMouseDown={(e) =>
                  startResize(asPointer(e), single.id, corner)
                }
                className="absolute left-0 top-0 touch-none rounded-[2px] border-primary bg-background"
                style={{
                  transform: `translate(${less(x, 5)}, ${less(y, 5)})`,
                  width: px(10),
                  height: px(10),
                  borderWidth: px(1.5),
                  zIndex: ordered.length + 3,
                  cursor:
                    corner === "nw" || corner === "se"
                      ? "nwse-resize"
                      : "nesw-resize",
                }}
              />
            );
          })}
        {guides.map((g, i) => (
          <div
            key={i}
            className="pointer-events-none absolute left-0 top-0 bg-rose-500"
            style={
              g.axis === "x"
                ? {
                    transform: `translate(${less(g.at, 0.5)}, ${g.from}px)`,
                    width: px(1),
                    height: g.to - g.from,
                    zIndex: ordered.length + 4,
                  }
                : {
                    transform: `translate(${g.from}px, ${less(g.at, 0.5)})`,
                    width: g.to - g.from,
                    height: px(1),
                    zIndex: ordered.length + 4,
                  }
            }
          />
        ))}
      </div>

      {marquee && (
        <div
          className="pointer-events-none absolute rounded-sm border border-primary bg-primary/10"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
          }}
        />
      )}

      {!busy && !cameraMoving && !placing && overlay}

      {placing && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <span className="rounded-full border bg-popover/95 px-3.5 py-1.5 text-sm text-popover-foreground shadow-sm backdrop-blur">
            Click where the {PLACING_LABEL[placing]} goes · Esc to cancel
          </span>
        </div>
      )}

      {menu && (
        <div
          role="menu"
          aria-label="Add to the board"
          className="absolute z-20 min-w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ["Heading here", () => actions.addNoteAt(menu.at, "heading")],
              ["Text here", () => actions.addNoteAt(menu.at, "text")],
              ["Sticky note here", () => actions.addNoteAt(menu.at, "sticky")],
              [
                "Select all",
                () => setSelection(new Set(Object.keys(current.current))),
              ],
              ["Show everything", () => actions.fit()],
            ] as const
          ).map(([label, run]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                setMenu(null);
                run();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
          <span className="rounded-full bg-background/90 px-4 py-2 text-sm font-medium shadow-sm">
            Drop to put it on the board
          </span>
        </div>
      )}
    </div>
  );
}
