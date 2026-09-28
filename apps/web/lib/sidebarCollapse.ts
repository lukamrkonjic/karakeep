"use client";

import { useCallback } from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { create } from "zustand";

/**
 * Whether the desktop sidebar is folded in. Kept in the account
 * (lib/uiPreferences.tsx) — see SidebarCollapseToggle (the header's sidebar
 * button) and SidebarCollapseWrapper (the div that hides/shows the aside).
 */
export function useSidebarCollapsed(): boolean {
  return usePreference("sidebarCollapsed") ?? false;
}

export function useToggleSidebarCollapsed() {
  const updatePreferences = useUpdatePreferences();
  return useCallback(() => {
    unpeekSidebar();
    void updatePreferences((prefs) => ({
      sidebarCollapsed: !prefs.sidebarCollapsed,
    }));
  }, [updatePreferences]);
}

/**
 * Fork: a folded sidebar peeks — pointing at the sidebar button slides it in
 * over the page, and leaving it slides it away again. The waits keep a
 * pointer passing by from opening it, and give one time to go from the
 * button down into the sidebar.
 */
export const useSidebarPeek = create<{ peeking: boolean }>(() => ({
  peeking: false,
}));

const PEEK_AFTER_MS = 150;
const UNPEEK_AFTER_MS = 300;
let peekTimer: ReturnType<typeof setTimeout> | undefined;

function peekLater(peeking: boolean, ms: number) {
  clearTimeout(peekTimer);
  if (useSidebarPeek.getState().peeking !== peeking) {
    peekTimer = setTimeout(() => useSidebarPeek.setState({ peeking }), ms);
  }
}

/** The pointer came to the button, or back into the peeking sidebar. */
export const peekSidebarSoon = () => peekLater(true, PEEK_AFTER_MS);
/** The pointer left them. */
export const unpeekSidebarSoon = () => peekLater(false, UNPEEK_AFTER_MS);

export function unpeekSidebar() {
  clearTimeout(peekTimer);
  useSidebarPeek.setState({ peeking: false });
}
