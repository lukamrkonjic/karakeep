"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

/**
 * Whether this list shows the items of everything nested under it, and a
 * toggle for it. Kept in the account's preferences, which the list page
 * reads on the server too, so it renders right the first time.
 */
export function useShowSublists(listId: string) {
  const router = useRouter();
  const updatePreferences = useUpdatePreferences();
  const showSublists = usePreference("sublists")?.includes(listId) ?? false;

  const onClickShowSublists = useCallback(async () => {
    await updatePreferences(
      (prefs) => {
        const ids = new Set(prefs.sublists);
        if (ids.has(listId)) {
          ids.delete(listId);
        } else {
          ids.add(listId);
        }
        return { sublists: [...ids] };
      },
      { immediate: true },
    );
    router.refresh();
  }, [listId, router, updatePreferences]);

  return { showSublists, onClickShowSublists };
}
