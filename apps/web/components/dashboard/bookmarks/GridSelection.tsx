"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "@/lib/auth/client";
import useBulkActionsStore from "@/lib/bulkActions";
import { selectAllLoaded, setSelection } from "@/lib/selection";
import { useHotkeys } from "react-hotkeys-hook";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

// The pointer must travel this far before a press on empty space becomes a
// box (a plain click there does nothing).
const START_PX = 4;
// Near the top or bottom edge the page scrolls, faster the closer it is.
const EDGE_PX = 56;
const MAX_SCROLL_PX = 24;

// Where a press can't start a box: the cards themselves (they drag onto
// lists), controls, and text (which is still selectable).
const NOT_EMPTY =
  "[data-bookmark-index], a, button, input, textarea, select, label, summary, [role=button], [role=menuitem], [role=dialog], [contenteditable=true], [data-no-marquee]";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement; cur; cur = cur.parentElement) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === "auto" || overflowY === "scroll") {
      return cur;
    }
  }
  return null; // the window scrolls
}

function isEmptySpace(target: EventTarget | null) {
  if (!(target instanceof HTMLElement) || target.closest(NOT_EMPTY)) {
    return false;
  }
  return ![...target.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
}

/**
 * Fork: selecting like a desktop's icons — press on empty space around the
 * cards and drag, and a box picks every card it touches; the page scrolls
 * when the box reaches its top or bottom edge. Ctrl/⌘ or Shift held at the
 * start adds to what's picked; Esc puts things back as they were. Mouse
 * only (a finger scrolls). Also Ctrl/⌘+A: every card loaded. Your own
 * bookmarks only, as the selection's round boxes (lib/selection.ts).
 */
export function GridSelection() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useHotkeys(
    "ctrl+a, meta+a",
    (e) => {
      if (document.querySelector("[role=dialog]")) {
        return; // a dialog's own text
      }
      e.preventDefault();
      selectAllLoaded((b) => b.userId === userIdRef.current);
    },
    { enabled: !!userId },
    [userId],
  );

  useEffect(() => {
    const scroller = scrollParentOf(anchorRef.current);
    const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY);
    const view = () =>
      scroller
        ? scroller.getBoundingClientRect()
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const canSelect = (b: ZBookmark | undefined) =>
      !!b && b.userId === userIdRef.current;

    // One press at a time: where it started (y in page terms, so the box
    // keeps its start while the page scrolls), and what was picked before.
    let press: {
      x: number;
      y: number;
      additive: boolean;
      before: { on: boolean; ids: string[] };
      active: boolean;
    } | null = null;
    let pointer = { x: 0, y: 0 };
    let lastIds = "";
    let frame = 0;

    const update = () => {
      if (!press) {
        return;
      }
      const top = scrollTop();
      const x1 = Math.min(press.x, pointer.x);
      const x2 = Math.max(press.x, pointer.x);
      const y1 = Math.min(press.y, pointer.y + top) - top;
      const y2 = Math.max(press.y, pointer.y + top) - top;
      const v = view();
      const left = Math.max(x1, v.left);
      const upper = Math.max(y1, v.top);
      setBox({
        left,
        top: upper,
        width: Math.max(0, Math.min(x2, v.right) - left),
        height: Math.max(0, Math.min(y2, v.bottom) - upper),
      });

      const { visibleBookmarks } = useBulkActionsStore.getState();
      const picked = new Set(press.additive ? press.before.ids : []);
      const root = scroller ?? document.body;
      for (const el of root.querySelectorAll<HTMLElement>(
        "[data-bookmark-index]",
      )) {
        const r = el.getBoundingClientRect();
        if (r.right < x1 || r.left > x2 || r.bottom < y1 || r.top > y2) {
          continue;
        }
        const bookmark = visibleBookmarks[Number(el.dataset.bookmarkIndex)];
        if (canSelect(bookmark)) {
          picked.add(bookmark.id);
        }
      }
      const ids = [...picked];
      const key = ids.join(",");
      if (key !== lastIds) {
        lastIds = key;
        setSelection(ids);
      }
    };

    const autoScroll = () => {
      frame = 0;
      if (!press?.active) {
        return;
      }
      const v = view();
      let dy = 0;
      if (pointer.y < v.top + EDGE_PX) {
        dy = -Math.ceil((v.top + EDGE_PX - pointer.y) / 3);
      } else if (pointer.y > v.bottom - EDGE_PX) {
        dy = Math.ceil((pointer.y - (v.bottom - EDGE_PX)) / 3);
      }
      dy = Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, dy));
      if (dy !== 0) {
        if (scroller) {
          scroller.scrollTop += dy;
        } else {
          window.scrollBy(0, dy);
        }
        update();
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const noTextSelection = (e: Event) => e.preventDefault();

    const finish = (restore: boolean) => {
      if (!press) {
        return;
      }
      const { active, before } = press;
      press = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("selectstart", noTextSelection);
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!active) {
        return;
      }
      document.body.style.userSelect = "";
      setBox(null);
      const { selectedBookmarkIds } = useBulkActionsStore.getState();
      if (restore || (!before.on && selectedBookmarkIds.length === 0)) {
        // Esc — or a box that picked nothing when nothing was being picked.
        useBulkActionsStore.setState({
          isBulkEditEnabled: before.on,
          selectedBookmarkIds: before.ids,
        });
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!press) {
        return;
      }
      pointer = { x: e.clientX, y: e.clientY };
      if (!press.active) {
        if (
          Math.hypot(e.clientX - press.x, e.clientY + scrollTop() - press.y) <
          START_PX
        ) {
          return;
        }
        press.active = true;
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
        frame = requestAnimationFrame(autoScroll);
      }
      update();
    };

    const onUp = () => finish(false);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && press?.active) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (
        e.pointerType !== "mouse" ||
        e.button !== 0 ||
        !userIdRef.current ||
        !isEmptySpace(e.target)
      ) {
        return;
      }
      // Not on the scroll bar.
      if (scroller && e.clientX >= view().left + scroller.clientWidth) {
        return;
      }
      const { isBulkEditEnabled, selectedBookmarkIds } =
        useBulkActionsStore.getState();
      press = {
        x: e.clientX,
        y: e.clientY + scrollTop(),
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
        before: {
          on: isBulkEditEnabled,
          ids: isBulkEditEnabled ? selectedBookmarkIds : [],
        },
        active: false,
      };
      pointer = { x: e.clientX, y: e.clientY };
      // What's picked now, so a box that touches nothing yet (and isn't
      // adding) clears it.
      lastIds = press.before.ids.join(",");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey, true);
      document.addEventListener("selectstart", noTextSelection);
    };

    const target: HTMLElement | Document = scroller ?? document;
    target.addEventListener("pointerdown", onDown as EventListener);
    return () => {
      target.removeEventListener("pointerdown", onDown as EventListener);
      finish(false);
    };
  }, []);

  return (
    <>
      <span ref={anchorRef} hidden />
      {box &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-40 rounded-sm border border-primary bg-primary/15"
            style={box}
          />,
          document.body,
        )}
    </>
  );
}
