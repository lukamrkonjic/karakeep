import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PreviewDetailsState {
  hidden: boolean;
  toggle: () => void;
}

/**
 * Fork: whether an opened bookmark shows its details panel — one setting for
 * every preview, kept in localStorage. Hide it on one picture and the next
 * opens without it too, until it's shown again. (zustand renders the default
 * during hydration, so a server-rendered preview doesn't mismatch.)
 */
export const usePreviewDetails = create<PreviewDetailsState>()(
  persist(
    (set, get) => ({
      hidden: false,
      toggle: () => set({ hidden: !get().hidden }),
    }),
    { name: "karakeep-preview-details-hidden" },
  ),
);
