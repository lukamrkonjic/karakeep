/**
 * MIME type used in HTML5 drag-and-drop dataTransfer to identify a sidebar
 * list being dragged to reorder it among its siblings (see
 * CollapsibleBookmarkLists.tsx's ReorderableSiblings). Distinct from
 * BOOKMARK_DRAG_MIME (bookmarks dragged onto a list) so the two drag
 * interactions never get confused for one another.
 */
export const LIST_DRAG_MIME = "application/x-karakeep-list-id";
