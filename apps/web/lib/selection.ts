import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import useBulkActionsStore from "./bulkActions";

/**
 * Fork: picking bookmarks the way a desktop does. A card's round box, a long
 * press, a Ctrl/⌘-click, a box dragged around cards (GridSelection) or "…" →
 * Select starts it; then a click ticks or unticks a card, Shift-click takes
 * everything from the last one picked to this one, Ctrl/⌘+A takes all that's
 * loaded. Select mode stays on until it's closed (the bar's ✕, Esc, leaving
 * the page), also with nothing picked: upstream's toggle closed it when the
 * last card was unticked, which made the bar vanish mid-task.
 */

/** Where a Shift-click range starts: the last card ticked or unticked. */
let anchorId: string | null = null;

/** The ids from `from` to `to`, both included, in `order`. */
export function idsBetween(order: string[], from: string, to: string) {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (b < 0) {
    return [];
  }
  if (a < 0) {
    return [to];
  }
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function currentSelection() {
  const { isBulkEditEnabled, selectedBookmarkIds } =
    useBulkActionsStore.getState();
  return isBulkEditEnabled ? selectedBookmarkIds : [];
}

/** Select mode on, with this bookmark picked (or nothing, from a menu). */
export function startSelection(bookmarkId?: string) {
  anchorId = bookmarkId ?? null;
  useBulkActionsStore.setState({
    isBulkEditEnabled: true,
    selectedBookmarkIds: bookmarkId ? [bookmarkId] : [],
  });
}

/** Ticks or unticks one bookmark; select mode stays on either way. */
export function toggleSelection(bookmarkId: string) {
  const current = currentSelection();
  anchorId = bookmarkId;
  useBulkActionsStore.setState({
    isBulkEditEnabled: true,
    selectedBookmarkIds: current.includes(bookmarkId)
      ? current.filter((id) => id !== bookmarkId)
      : [...current, bookmarkId],
  });
}

/**
 * Shift-click: adds everything between the last bookmark picked and this
 * one, in the grid's order, skipping what `canSelect` refuses (others'
 * bookmarks in a shared list). The range start stays where it was, as on a
 * desktop.
 */
export function selectRangeTo(
  bookmarkId: string,
  canSelect: (bookmark: ZBookmark) => boolean,
) {
  const { visibleBookmarks } = useBulkActionsStore.getState();
  const order = visibleBookmarks.filter(canSelect).map((b) => b.id);
  if (!anchorId || !order.includes(anchorId)) {
    anchorId = bookmarkId;
  }
  const picked = new Set(currentSelection());
  for (const id of idsBetween(order, anchorId, bookmarkId)) {
    picked.add(id);
  }
  useBulkActionsStore.setState({
    isBulkEditEnabled: true,
    selectedBookmarkIds: [...picked],
  });
}

/** Exactly these picked, select mode on (the box drag's live result). */
export function setSelection(bookmarkIds: string[]) {
  useBulkActionsStore.setState({
    isBulkEditEnabled: true,
    selectedBookmarkIds: bookmarkIds,
  });
}

/** Ctrl/⌘+A: every loaded bookmark that may be picked. */
export function selectAllLoaded(canSelect: (bookmark: ZBookmark) => boolean) {
  const { visibleBookmarks } = useBulkActionsStore.getState();
  anchorId = null;
  setSelection(visibleBookmarks.filter(canSelect).map((b) => b.id));
}
