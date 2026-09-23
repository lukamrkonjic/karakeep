"use client";

import { useCallback } from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

/**
 * Fork: whether an opened bookmark hides its details panel — one setting for
 * every preview, kept in the account (lib/uiPreferences.tsx). Hide it on one
 * picture and the next opens without it too, on every device, until it's
 * shown again.
 */
export function usePreviewDetailsHidden(): boolean {
  return usePreference("previewDetailsHidden") ?? false;
}

export function useTogglePreviewDetails() {
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    () =>
      void updatePreferences((prefs) => ({
        previewDetailsHidden: !prefs.previewDetailsHidden,
      })),
    [updatePreferences],
  );
}
