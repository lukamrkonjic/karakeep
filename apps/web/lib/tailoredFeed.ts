import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TailoredFeedState {
  /**
   * Lists left out of the tailored feed. Stored as exclusions rather than a
   * selection so a list created later is in the feed until you take it out.
   */
  excluded: string[];
  setExcluded: (ids: string[]) => void;
}

/**
 * Which lists the tailored feed (/dashboard/feed) draws from. Persisted to
 * localStorage — per browser, like the sidebar's collapsed state.
 */
export const useTailoredFeed = create<TailoredFeedState>()(
  persist(
    (set) => ({
      excluded: [],
      setExcluded: (excluded) => set({ excluded }),
    }),
    { name: "karakeep-tailored-feed" },
  ),
);
