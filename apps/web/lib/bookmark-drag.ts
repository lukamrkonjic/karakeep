/**
 * MIME type used in HTML5 drag-and-drop dataTransfer to identify
 * bookmark card drags (as opposed to file drops). Its value is the dragged
 * bookmarks' ids, comma-separated (fork: a selection drags all of it).
 */
export const BOOKMARK_DRAG_MIME = "application/x-karakeep-bookmark";

/**
 * When present, carries the id of the manual list the bookmark was dragged
 * out of. Only set when actively browsing a manual list (see
 * useBookmarkDrag) — smart lists are computed from a query and can't have a
 * bookmark removed from them. A drop that moves removes the bookmark from
 * that list after adding it to the target; without it (dragged from home,
 * search, a tag) from every list it was in. Holding Ctrl (or Alt/Option)
 * adds instead: the bookmark keeps its lists (see useListDrop).
 */
export const BOOKMARK_DRAG_SOURCE_LIST_MIME =
  "application/x-karakeep-bookmark-source-list";

/** Whether this drag event carries bookmarks. */
export function isBookmarkDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME);
}

/** The bookmarks a drop carries (only readable on drop). */
export function draggedBookmarkIds(e: React.DragEvent): string[] {
  return e.dataTransfer.getData(BOOKMARK_DRAG_MIME).split(",").filter(Boolean);
}

/**
 * Fork: a drop adds (keeps the bookmark's other lists) instead of moving
 * while Ctrl — or Alt/Option, the Mac's usual copy key — is held.
 */
export function isAddDrag(e: React.DragEvent): boolean {
  return e.ctrlKey || e.altKey;
}
