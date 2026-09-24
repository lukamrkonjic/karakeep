"use client";

import { useRef, useState } from "react";

/**
 * Fork: a picture the way a phone's photo viewer handles it. Pinch or
 * double-tap to zoom, drag to look around once zoomed. At normal size, a drag
 * down closes it and a drag sideways moves to the next or previous one; a
 * single tap is handed on (the viewer shows or hides its bars).
 */

const MAX_SCALE = 6;
const DOUBLE_TAP_MS = 280;
const TAP_SLOP = 8;

interface View {
  scale: number;
  x: number;
  y: number;
}
const HOME: View = { scale: 1, x: 0, y: 0 };

type Gesture =
  | { kind: "pinch"; startDistance: number; start: View; startMid: Point }
  | {
      kind: "one";
      start: View;
      startPoint: Point;
      mode: "undecided" | "pan" | "dismiss" | "swipe";
    };

interface Point {
  x: number;
  y: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function TouchZoomImage({
  src,
  alt,
  onTap,
  onSwipeDown,
  onSwipeLeft,
  onSwipeRight,
}: {
  src: string;
  alt: string;
  onTap?: () => void;
  onSwipeDown?: () => void;
  /** The next picture; undefined when there is none. */
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const [view, setViewState] = useState<View>(HOME);
  const [drag, setDragState] = useState<Point>({ x: 0, y: 0 });
  // The same, as of the latest event (the state is a render behind).
  const viewNow = useRef<View>(HOME);
  const dragNow = useRef<Point>({ x: 0, y: 0 });
  const setView = (v: View) => {
    viewNow.current = v;
    setViewState(v);
  };
  const setDrag = (d: Point) => {
    dragNow.current = d;
    setDragState(d);
  };
  const [active, setActive] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A point relative to the box's centre (the transform's origin).
  const local = (e: React.PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: e.clientX - r.left - r.width / 2,
      y: e.clientY - r.top - r.height / 2,
    };
  };
  // Zoomed in, the picture may move no further than its own overhang.
  const bounded = (v: View): View => {
    const r = box.current!.getBoundingClientRect();
    const mx = ((v.scale - 1) * r.width) / 2;
    const my = ((v.scale - 1) * r.height) / 2;
    return { scale: v.scale, x: clamp(v.x, -mx, mx), y: clamp(v.y, -my, my) };
  };
  const midpoint = (): Point => {
    const [a, b] = [...pointers.current.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    box.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    setActive(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: "pinch",
        startDistance: distance(a, b) || 1,
        start: viewNow.current,
        startMid: midpoint(),
      };
      setDrag({ x: 0, y: 0 });
    } else if (pointers.current.size === 1) {
      gesture.current = {
        kind: "one",
        start: viewNow.current,
        startPoint: local(e),
        mode: "undecided",
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      return;
    }
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) {
      return;
    }
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const scale = clamp(
        (g.start.scale * distance(a, b)) / g.startDistance,
        1,
        MAX_SCALE,
      );
      // Keep the picture's point under the fingers' first midpoint under
      // where the fingers are now.
      const m = midpoint();
      const f = scale / g.start.scale;
      setView(
        bounded({
          scale,
          x: m.x - f * (g.startMid.x - g.start.x),
          y: m.y - f * (g.startMid.y - g.start.y),
        }),
      );
      return;
    }
    if (g.kind !== "one") {
      return;
    }
    const p = local(e);
    const dx = p.x - g.startPoint.x;
    const dy = p.y - g.startPoint.y;
    if (g.mode === "undecided") {
      if (Math.hypot(dx, dy) < TAP_SLOP) {
        return;
      }
      g.mode =
        g.start.scale > 1
          ? "pan"
          : Math.abs(dy) > Math.abs(dx)
            ? "dismiss"
            : "swipe";
    }
    if (g.mode === "pan") {
      setView(bounded({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }));
    } else if (g.mode === "dismiss") {
      setDrag({ x: 0, y: Math.max(0, dy) });
    } else {
      // Resisting past the ends of the list.
      const blocked = (dx < 0 && !onSwipeLeft) || (dx > 0 && !onSwipeRight);
      setDrag({ x: blocked ? dx / 4 : dx, y: 0 });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const point = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // A pinch lost a finger: carry on with the other as a pan.
      if (g?.kind === "pinch") {
        const [rest] = [...pointers.current.values()];
        gesture.current = {
          kind: "one",
          start: viewNow.current,
          startPoint: rest,
          mode: viewNow.current.scale > 1 ? "pan" : "undecided",
        };
      }
      return;
    }
    setActive(false);
    gesture.current = null;
    if (!g) {
      return;
    }
    if (g.kind === "pinch") {
      if (viewNow.current.scale < 1.05) {
        setView(HOME);
      }
      return;
    }
    if (g.mode === "undecided") {
      // A tap: two in quick succession zoom in (or back out).
      const now = Date.now();
      const previous = lastTap.current;
      if (
        previous &&
        now - previous.at < DOUBLE_TAP_MS &&
        distance(previous.point, point) < 40
      ) {
        lastTap.current = null;
        if (tapTimer.current) {
          clearTimeout(tapTimer.current);
          tapTimer.current = null;
        }
        const scale = 2.5;
        setView(
          viewNow.current.scale > 1
            ? HOME
            : bounded({
                scale,
                x: -(scale - 1) * point.x,
                y: -(scale - 1) * point.y,
              }),
        );
        return;
      }
      lastTap.current = { at: now, point };
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        onTap?.();
      }, DOUBLE_TAP_MS);
      return;
    }
    const moved = dragNow.current;
    if (g.mode === "dismiss" && moved.y > 110 && onSwipeDown) {
      onSwipeDown();
      return;
    }
    if (g.mode === "swipe") {
      if (moved.x < -70 && onSwipeLeft) {
        onSwipeLeft();
      } else if (moved.x > 70 && onSwipeRight) {
        onSwipeRight();
      }
    }
    setDrag({ x: 0, y: 0 });
  };

  // Dragging down fades the black behind and shrinks the picture a little,
  // as the phone's own viewer does.
  const lift = Math.min(drag.y / 500, 1);
  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      style={{ backgroundColor: `rgba(0, 0, 0, ${1 - lift * 0.8})` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* oxlint-disable-next-line nextjs/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="h-full w-full object-contain [-webkit-touch-callout:none]"
        style={{
          transform: `translate(${view.x + drag.x}px, ${view.y + drag.y}px) scale(${view.scale * (1 - lift * 0.25)})`,
          transition: active ? "none" : "transform 220ms ease-out",
        }}
      />
    </div>
  );
}
