"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  PAGE_SORT_COOKIE,
  parsePageSorts,
  serializePageSorts,
} from "@/lib/pageSort";

/** Fork: the "…" menus' Sort (see lib/pageSort.ts), live in the browser. */

const listeners = new Set<() => void>();

function readCookie(): string {
  return (
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${PAGE_SORT_COOKIE}=`))
      ?.slice(PAGE_SORT_COOKIE.length + 1) ?? ""
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Every page's sort choice. The server render and hydration see none (the
 * server-rendered grids read the cookie themselves), so nothing mismatches.
 */
export function usePageSorts(): Map<string, string> {
  const raw = useSyncExternalStore(subscribe, readCookie, () => "");
  return useMemo(() => parsePageSorts(raw), [raw]);
}

/**
 * Sets one page's sort; `null` puts it back to the default. Re-renders the
 * current page, so a server-rendered grid reloads in the new order.
 */
export function useSetPageSort() {
  const router = useRouter();
  return useCallback(
    (key: string, sort: string | null) => {
      const sorts = parsePageSorts(readCookie());
      // Re-added at the end: the newest choices survive the cookie's cap.
      sorts.delete(key);
      if (sort) {
        sorts.set(key, sort);
      }
      // A year, path-wide, so it holds on every page in this browser.
      document.cookie = `${PAGE_SORT_COOKIE}=${serializePageSorts(sorts)}; path=/; max-age=31536000; samesite=lax`;
      listeners.forEach((listener) => listener());
      router.refresh();
    },
    [router],
  );
}
