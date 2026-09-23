"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Minus, Plus, RotateCcw } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** What one press of + or − zooms by. */
const STEP = 1.5;

interface View {
  scale: number;
  x: number;
  y: number;
}
const HOME: View = { scale: 1, x: 0, y: 0 };

/**
 * Whether an event is on the pane's buttons rather than the picture — their
 * whole group (`data-pane-controls`), as a disabled button lets clicks through
 * to the group behind it.
 */
function onControl(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, [data-pane-controls]") !== null
  );
}

function ControlButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md bg-black/40 p-1.5 text-white/80 transition-colors hover:bg-black/60 hover:text-white disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Fork: the preview's picture, zoomable. Scroll (or pinch) over it to zoom in
 * where the pointer is, drag to look around once zoomed in, and the buttons
 * bottom right step in, out, and back. At its normal size a click on it is
 * `onClick` (the modal closes).
 *
 * Renders the black pane the picture sits in (`className`), so scrolling
 * anywhere on it zooms; `children` are overlaid on the pane.
 */
export function ZoomableImage({
  src,
  className,
  imageClassName,
  onClick,
  children,
}: {
  src: string;
  className?: string;
  imageClassName?: string;
  /** A click on the pane at the normal size, not on one of its buttons. */
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(HOME);
  // Buttons glide; the wheel and dragging follow the pointer directly.
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  // A new picture starts unzoomed.
  useEffect(() => setView(HOME), [src]);

  /** Keeps the picture covering the pane: no dragging it off the edge. */
  const clamp = useCallback((v: View): View => {
    const image = imageRef.current;
    if (!image || v.scale <= MIN_SCALE) {
      return HOME;
    }
    const maxX = ((v.scale - 1) * image.offsetWidth) / 2;
    const maxY = ((v.scale - 1) * image.offsetHeight) / 2;
    return {
      scale: v.scale,
      x: Math.max(-maxX, Math.min(maxX, v.x)),
      y: Math.max(-maxY, Math.min(maxY, v.y)),
    };
  }, []);

  /**
   * Zooms by `factor`, keeping the point (px, py) — measured from the pane's
   * centre, where the picture sits — under the pointer.
   */
  const zoomBy = useCallback(
    (factor: number, px = 0, py = 0) => {
      setView((v) => {
        const scale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, v.scale * factor),
        );
        const k = scale / v.scale;
        return clamp({ scale, x: px - k * (px - v.x), y: py - k * (py - v.y) });
      });
    },
    [clamp],
  );

  // React's wheel listener is passive, and zooming must stop the scroll.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = pane.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      // A trackpad pinch arrives as ctrl + wheel, in small steps.
      const speed = e.ctrlKey ? 0.01 : 0.002;
      setAnimate(false);
      zoomBy(
        Math.exp(-e.deltaY * unit * speed),
        e.clientX - (rect.left + rect.width / 2),
        e.clientY - (rect.top + rect.height / 2),
      );
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const zoomed = view.scale > MIN_SCALE;
  const step = (factor: number | null) => {
    setAnimate(true);
    if (factor === null) {
      setView(HOME);
    } else {
      zoomBy(factor);
    }
  };

  return (
    <div
      ref={paneRef}
      className={cn("overflow-hidden", className)}
      // Pointer conveniences only (zoom, pan, click to close — Esc closes
      // too); the buttons on it are the pane's accessible parts.
      role="presentation"
      onPointerDown={(e) => {
        moved.current = false;
        // Capturing the pointer would take the click away from a button
        // on the pane (these controls, the open and details buttons).
        if (!zoomed || e.button !== 0 || onControl(e.target)) {
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY };
        setAnimate(false);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) {
          return;
        }
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) {
          moved.current = true;
        }
        drag.current = { x: e.clientX, y: e.clientY };
        setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      // Zoomed in, a click is for looking around, not for leaving.
      onClick={(e) => {
        if (!zoomed && !moved.current && !onControl(e.target)) {
          onClick?.();
        }
      }}
    >
      <div
        className={cn(zoomed && (dragging ? "cursor-grabbing" : "cursor-grab"))}
      >
        <Image
          ref={imageRef}
          alt="asset"
          src={src}
          width={0}
          height={0}
          sizes="95vw"
          unoptimized
          priority
          draggable={false}
          className={cn("select-none will-change-transform", imageClassName)}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: animate ? "transform 150ms ease-out" : undefined,
          }}
        />
      </div>
      {children}
      <div
        data-pane-controls
        className="absolute bottom-3 right-3 z-10 flex items-center gap-1"
      >
        <ControlButton
          label="Zoom out"
          disabled={!zoomed}
          onClick={() => step(1 / STEP)}
        >
          <Minus size={18} />
        </ControlButton>
        <ControlButton
          label="Zoom in"
          disabled={view.scale >= MAX_SCALE}
          onClick={() => step(STEP)}
        >
          <Plus size={18} />
        </ControlButton>
        <ControlButton
          label="Reset zoom"
          disabled={!zoomed}
          onClick={() => step(null)}
        >
          <RotateCcw size={18} />
        </ControlButton>
      </div>
    </div>
  );
}
