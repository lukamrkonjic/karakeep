import { useCallback } from "react";
import {
  BOOKMARK_DRAG_MIME,
  BOOKMARK_DRAG_SOURCE_LIST_MIME,
} from "@/lib/bookmark-drag";

import { useBookmarkListContext } from "@karakeep/shared-react/hooks/bookmark-list-context";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

/**
 * Shared HTML5 drag-start handler for dragging a bookmark onto a sidebar
 * list (see AllLists.tsx's useDropTarget, which reads BOOKMARK_DRAG_MIME).
 * Used by both the grid/list card's drag handle and the masonry tile, which
 * has no room for a separate handle icon and is draggable as a whole.
 */
export function useBookmarkDragStart(bookmark: ZBookmark) {
  // If we're currently browsing a manual list, tag the drag with it so a
  // drop target can remove the bookmark from here too (a true "move"
  // instead of just adding to the target list). Smart lists can't have a
  // bookmark removed from them since they're computed from a query.
  const listContext = useBookmarkListContext();
  const sourceListId =
    listContext?.type === "manual" ? listContext.id : undefined;

  return useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(BOOKMARK_DRAG_MIME, bookmark.id);
      if (sourceListId) {
        e.dataTransfer.setData(BOOKMARK_DRAG_SOURCE_LIST_MIME, sourceListId);
      }
      e.dataTransfer.effectAllowed = sourceListId ? "move" : "copy";

      // Create a small pill element as the drag preview
      const pill = document.createElement("div");
      const title = getBookmarkTitle(bookmark) ?? "Untitled";
      pill.textContent =
        title.length > 40 ? title.substring(0, 40) + "…" : title;
      Object.assign(pill.style, {
        position: "fixed",
        left: "-9999px",
        top: "-9999px",
        padding: "6px 12px",
        borderRadius: "8px",
        backgroundColor: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        fontSize: "13px",
        fontFamily: "inherit",
        color: "hsl(var(--foreground))",
        maxWidth: "240px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      document.body.appendChild(pill);
      e.dataTransfer.setDragImage(pill, 0, 0);
      requestAnimationFrame(() => pill.remove());
    },
    [bookmark, sourceListId],
  );
}
