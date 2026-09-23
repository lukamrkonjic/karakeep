"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { PageSorts } from "@/lib/pageSort";
import { withPageSort } from "@/lib/pageSort";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

/** Fork: the "…" menus' Sort (see lib/pageSort.ts), from the account. */

const NONE: PageSorts = {};

/** Every page's sort choice (only the ones changed from the default). */
export function usePageSorts(): PageSorts {
  return usePreference("pageSorts") ?? NONE;
}

/**
 * Sets one page's sort; `null` puts it back to the default. Once saved,
 * re-renders the current page, so a server-rendered grid reloads in the new
 * order.
 */
export function useSetPageSort() {
  const router = useRouter();
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    async (key: string, sort: string | null) => {
      await updatePreferences(
        (prefs) => ({ pageSorts: withPageSort(prefs.pageSorts, key, sort) }),
        { immediate: true },
      );
      router.refresh();
    },
    [router, updatePreferences],
  );
}
