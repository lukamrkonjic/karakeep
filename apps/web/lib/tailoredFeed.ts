"use client";

import { useCallback } from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

const NONE: string[] = [];

/**
 * Which lists the tailored feed (/dashboard/feed) draws from, as the lists
 * left out rather than a selection, so a list created later is in the feed
 * until you take it out. Kept in the account (lib/uiPreferences.tsx).
 */
export function useTailoredFeedExcluded(): string[] {
  return usePreference("tailoredFeedExcluded") ?? NONE;
}

export function useSetTailoredFeedExcluded() {
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    (excluded: string[]) =>
      void updatePreferences({ tailoredFeedExcluded: excluded }),
    [updatePreferences],
  );
}
