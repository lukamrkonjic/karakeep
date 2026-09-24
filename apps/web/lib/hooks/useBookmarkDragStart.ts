import { useCallback } from "react";
import {
  BOOKMARK_DRAG_MIME,
  BOOKMARK_DRAG_SOURCE_LIST_MIME,
  setDraggedBookmarkCount,
} from "@/lib/bookmark-drag";
import { setBookmarkDragImage } from "@/lib/bookmarkDragImage";
import useBulkActionsStore from "@/lib/bulkActions";
import { useIsTouch } from "@/lib/hooks/useIsPhone";

import { useBookmarkListContext } from "@karakeep/shared-react/hooks/bookmark-list-context";
import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

/**
 * Makes a card draggable onto a list (the sidebar's, or a list page's
 * sub-list tiles — see useListDrop). Fork: the whole card, in every layout;
 * a card that's part of the selection drags the whole selection; a small
 * picture of it follows the pointer (bookmarkDragImage). Not by touch, where
 * a long press opens the card's actions instead.
 */
export function useBookmarkDrag(bookmark: ZBookmark) {
  // If we're currently browsing a manual list, tag the drag with it so a
  // drop target can remove the bookmark from here too (a true "move"
  // instead of just adding to the target list). Smart lists can't have a
  // bookmark removed from them since they're computed from a query.
  const listContext = useBookmarkListContext();
  const sourceListId =
    listContext?.type === "manual" ? listContext.id : undefined;
  const isTouch = useIsTouch();

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      const { isBulkEditEnabled, selectedBookmarkIds } =
        useBulkActionsStore.getState();
      const ids =
        isBulkEditEnabled && selectedBookmarkIds.includes(bookmark.id)
          ? selectedBookmarkIds
          : [bookmark.id];
      e.dataTransfer.setData(BOOKMARK_DRAG_MIME, ids.join(","));
      setDraggedBookmarkCount(ids.length);
      if (sourceListId) {
        e.dataTransfer.setData(BOOKMARK_DRAG_SOURCE_LIST_MIME, sourceListId);
      }
      // A drop moves, or adds with Ctrl/Alt held (useListDrop).
      e.dataTransfer.effectAllowed = "copyMove";
      setBookmarkDragImage(e, getBookmarkTitle(bookmark) ?? "", ids.length);
    },
    [bookmark, sourceListId],
  );

  return { draggable: !isTouch, onDragStart };
}
