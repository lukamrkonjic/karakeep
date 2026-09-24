import { useRef } from "react";
import { haptic } from "@/lib/haptic";

// A held mouse button waits a little longer than a finger: a quick press
// and drag must stay a drag.
const MOUSE_MS = 500;

/**
 * Fork: a finger held still on something — or, given `onMouseLongPress`,
 * the left mouse button (a mouse keeps its right-click either way). Moving
 * calls it off: a scroll by touch, a drag with a mouse (which starts a few
 * pixels in). The click that ends a long press doesn't also click, and
 * Android's own long-press menu stays shut.
 */
export function useLongPress(
  onLongPress: () => void,
  ms = 450,
  onMouseLongPress?: () => void,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; slop: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  const arm = (e: React.PointerEvent, delay: number, run: () => void) => {
    cancel();
    start.current = {
      x: e.clientX,
      y: e.clientY,
      slop: e.pointerType === "touch" ? 10 : 5,
    };
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      run();
    }, delay);
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType === "touch") {
        arm(e, ms, () => {
          haptic();
          onLongPress();
        });
      } else if (
        e.pointerType === "mouse" &&
        onMouseLongPress &&
        e.button === 0 &&
        !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
      ) {
        arm(e, MOUSE_MS, onMouseLongPress);
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > s.slop) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Capture: the card's own dragstart handler stops the event there.
    onDragStartCapture: cancel,
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
