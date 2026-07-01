import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarCollapseState {
  collapsed: boolean;
  toggle: () => void;
}

/**
 * Whether the desktop sidebar is folded in. Persisted to localStorage so it
 * survives a refresh — see SidebarCollapseToggle (the header arrow button)
 * and SidebarCollapseWrapper (the div that actually hides/shows the aside).
 */
export const useSidebarCollapse = create<SidebarCollapseState>()(
  persist(
    (set, get) => ({
      collapsed: false,
      toggle: () => set({ collapsed: !get().collapsed }),
    }),
    { name: "karakeep-sidebar-collapsed" },
  ),
);
