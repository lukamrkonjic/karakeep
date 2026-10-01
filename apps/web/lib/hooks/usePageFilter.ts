"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { PageFilter } from "@/lib/pageFilter";
import { pageFiltersOf, withPageFilters } from "@/lib/pageFilter";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

/** Fork: the "…" menus' Filter (see lib/pageFilter.ts), from the account. */

/** One page's filters. */
export function usePageFilters(key: string): PageFilter[] {
  const all = usePreference("pageFilters");
  return useMemo(() => pageFiltersOf(all, key), [all, key]);
}

/**
 * Sets one page's filters (none: unfiltered). Once saved, re-renders the
 * current page, so a server-rendered grid reloads with them.
 */
export function useSetPageFilters() {
  const router = useRouter();
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    async (key: string, filters: PageFilter[]) => {
      await updatePreferences(
        (prefs) => ({
          pageFilters: withPageFilters(prefs.pageFilters, key, filters),
        }),
        { immediate: true },
      );
      router.refresh();
    },
    [router, updatePreferences],
  );
}
