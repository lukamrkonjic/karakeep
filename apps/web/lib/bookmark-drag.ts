/**
 * MIME type used in HTML5 drag-and-drop dataTransfer to identify
 * bookmark card drags (as opposed to file drops).
 */
export const BOOKMARK_DRAG_MIME = "application/x-karakeep-bookmark";

/**
 * When present, carries the id of the manual list the bookmark was dragged
 * out of. Only set when actively browsing a manual list (see
 * useBookmarkDragStart) — smart lists are computed from a query and can't
 * have a bookmark removed from them. A drop target present with this MIME
 * removes the bookmark from that list after adding it to the target,
 * turning the drag into a true "move" instead of just adding to a list.
 */
export const BOOKMARK_DRAG_SOURCE_LIST_MIME =
  "application/x-karakeep-bookmark-source-list";
