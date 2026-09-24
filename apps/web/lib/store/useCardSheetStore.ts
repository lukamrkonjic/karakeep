import { create } from "zustand";

/**
 * Fork: whose actions sheet is open — a long press on a card (BookmarksGrid)
 * opens it, and the card's own options (BookmarkOptions) show it.
 */
export const useCardSheetStore = create<{
  openFor: string | null;
  open: (bookmarkId: string) => void;
  close: () => void;
}>((set) => ({
  openFor: null,
  open: (bookmarkId) => set({ openFor: bookmarkId }),
  close: () => set({ openFor: null }),
}));
