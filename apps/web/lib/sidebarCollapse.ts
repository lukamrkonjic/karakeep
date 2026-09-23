"use client";

import { useCallback } from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

/**
 * Whether the desktop sidebar is folded in. Kept in the account
 * (lib/uiPreferences.tsx) — see SidebarCollapseToggle (the header arrow
 * button) and SidebarCollapseWrapper (the div that hides/shows the aside).
 */
export function useSidebarCollapsed(): boolean {
  return usePreference("sidebarCollapsed") ?? false;
}

export function useToggleSidebarCollapsed() {
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    () =>
      void updatePreferences((prefs) => ({
        sidebarCollapsed: !prefs.sidebarCollapsed,
      })),
    [updatePreferences],
  );
}
