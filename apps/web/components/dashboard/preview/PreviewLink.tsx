"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useBulkActionsStore from "@/lib/bulkActions";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

// A mouse press that comes up this soon, this close to where it went down,
// opens the preview wherever the pointer is by then.
const PRESS_MS = 600;
const PRESS_SLOP_PX = 10;

/**
 * Fork: a link that opens a bookmark's preview. Its route is dynamic, so
 * Next doesn't fetch it ahead as the link scrolls into view, and a click
 * waited for the server before anything showed. This fetches it in full as
 * the pointer comes onto the link (or a finger touches it): by the click it's
 * there, and the preview opens at once. (Prefetching only runs in
 * production; `router.prefetch` is Next's own, with its full kind — what
 * `<Link prefetch>` does, for one link at a time.)
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
>(function PreviewLink(
  { onPointerEnter, onPointerDown, onTouchStart, onClick, ...props },
  ref,
) {
  const router = useRouter();
  const prefetch = () =>
    router.prefetch(props.href, { kind: PrefetchKind.FULL });
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
      const scroll = props.scroll ?? true;
      if (props.replace) {
        router.replace(props.href, { scroll });
      } else {
        router.push(props.href, { scroll });
      }
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
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType === "mouse") {
          prefetch();
        }
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        if (
          e.pointerType === "mouse" &&
          e.button === 0 &&
          !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
        ) {
          watchPress(e);
        }
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        prefetch();
      }}
      onClick={(e) => {
        onClick?.(e);
        if (performance.now() - openedAt.current < 1000) {
          // The press already opened it.
          openedAt.current = -Infinity;
          e.preventDefault();
        }
      }}
    />
  );
});
