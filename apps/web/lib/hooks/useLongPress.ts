import { useRef } from "react";
import { haptic } from "@/lib/haptic";

/**
 * Fork: a finger held still on something (touch only; a mouse keeps its
 * right-click). Moving — a scroll — calls it off. The tap that ends a long
 * press doesn't also click, and Android's own long-press menu stays shut.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") {
        return;
      }
      cancel();
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        haptic();
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      if (fired.current || timer.current) {
        e.preventDefault();
      }
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}
