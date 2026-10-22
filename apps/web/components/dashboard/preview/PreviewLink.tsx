"use client";

import * as React from "react";
import Link from "next/link";
import useBulkActionsStore from "@/lib/bulkActions";
import { previewIdOf, useOpenPreview } from "@/lib/previewNavigation";

// A mouse press that comes up this soon, this close to where it went down,
// opens the preview wherever the pointer is by then.
const PRESS_MS = 600;
const PRESS_SLOP_PX = 10;

/**
 * Fork: a link that opens a bookmark's preview — in place, over the page
 * (lib/previewNavigation.ts): nothing is fetched from the server first, so
 * it opens at once and can never land on the preview's own page. Ctrl/⌘-,
 * Shift- and middle-clicks are the browser's (a new tab or window).
 *
 * A mouse press opens it too when the browser drops the click: when the
 * tile moved under the pointer between down and up (pictures above it
 * finishing loading), or when the pointer slipped the 3 px that start
 * dragging the tile (onto a list) and the press ended as a tiny drag. The
 * click that may follow doesn't open it again.
 */
export const PreviewLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<typeof Link> & { href: string }
>(function PreviewLink({ onPointerDown, onClick, ...props }, ref) {
  const openPreview = useOpenPreview();
  // Any other link (a card set to open the original) is a plain one.
  const isPreview =
    previewIdOf(props.href.split(/[?#]/)[0] ?? "") !== null &&
    (!props.target || props.target === "_self");
  const open = () =>
    openPreview(props.href, {
      replace: props.replace,
      scroll: props.scroll ?? true,
    });
  // When a press last opened it, so the click after it is let go.
  const openedAt = React.useRef(-Infinity);
  const endPress = React.useRef<(() => void) | undefined>(undefined);
  React.useEffect(() => () => endPress.current?.(), []);

  const watchPress = (e: React.PointerEvent) => {
    endPress.current?.();
    openedAt.current = -Infinity;
    const { clientX: x, clientY: y, pointerId } = e;
    const release = (ev: MouseEvent) => {
      stop();
      // (written so an event without a place never counts as near)
      const near = Math.hypot(ev.clientX - x, ev.clientY - y) < PRESS_SLOP_PX;
      if (
        !near ||
        // A held press that started choosing cards (useLongPress).
        useBulkActionsStore.getState().isBulkEditEnabled
      ) {
        return;
      }
      openedAt.current = performance.now();
      open();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId && ev.button === 0) {
        release(ev);
      }
    };
    const timer = window.setTimeout(() => stop(), PRESS_MS);
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("dragend", release, true);
      endPress.current = undefined;
    };
    window.addEventListener("pointerup", onUp, true);
    // A drag ends without a pointerup.
    window.addEventListener("dragend", release, true);
    endPress.current = stop;
  };

  return (
    <Link
      ref={ref}
      {...props}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        if (
          isPreview &&
          e.pointerType === "mouse" &&
          e.button === 0 &&
          !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
        ) {
          watchPress(e);
        }
      }}
      onClick={(e) => {
        onClick?.(e);
        if (performance.now() - openedAt.current < 1000) {
          // The press already opened it.
          openedAt.current = -Infinity;
          e.preventDefault();
          return;
        }
        if (
          !isPreview ||
          e.defaultPrevented ||
          e.button !== 0 ||
          e.ctrlKey ||
          e.metaKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        // A tap, a key press, or a click the press didn't catch.
        e.preventDefault();
        open();
      }}
    />
  );
});
