"use client";

import { useCallback } from "react";
import { withPinned } from "@/lib/pinnedLists";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

/** Fork: the sidebar's pinned lists (see lib/pinnedLists.ts). */

const NONE: string[] = [];

/** The pinned lists' ids, in the order they were pinned. */
export function usePinnedLists(): string[] {
  return usePreference("pinnedLists") ?? NONE;
}

/** Pins a list (or unpins it, with false). */
export function useSetPinned() {
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    (listId: string, on: boolean) =>
      void updatePreferences((prefs) => ({
        pinnedLists: withPinned(prefs.pinnedLists, listId, on),
      })),
    [updatePreferences],
  );
}
