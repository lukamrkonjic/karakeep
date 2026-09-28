import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSortOrderStore } from "@/lib/store/useSortOrderStore";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";

import { useInSearchPageStore } from "../store/useInSearchPageStore";

/**
 * Fork: one search — the words, what's in the pictures and their colours
 * (routers/pictures.ts search), with no mode to pick. An old link's ?mode=
 * is just left out.
 */
function buildSearchHref(query: string) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  const queryString = params.toString();
  return `/dashboard/search${queryString ? `?${queryString}` : ""}`;
}

export function useBookmarkSearchState() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const pathname = usePathname();
  const lastSearch = useRef(searchQuery);

  // Only update the effective search state when on the search page.
  // This prevents the query from resetting when intercepting routes change
  // the URL (e.g., opening a bookmark preview dialog).
  if (pathname.startsWith("/dashboard/search")) {
    lastSearch.current = searchQuery;
  }

  const effectiveQuery = lastSearch.current;
  const parsed = useMemo(
    () => parseSearchQuery(effectiveQuery),
    [effectiveQuery],
  );

  return {
    searchQuery: effectiveQuery,
    parsedSearchQuery: parsed,
  };
}

export function useDoBookmarkSearch() {
  const router = useRouter();
  const { searchQuery } = useBookmarkSearchState();
  const isInSearchPage = useInSearchPageStore((val) => val.inSearchPage);
  const timeoutId = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (!timeoutId.current) {
        return;
      }
      clearTimeout(timeoutId.current);
    };
  }, []);

  const doSearch = useCallback(
    (val: string) => {
      timeoutId.current = null;
      router.replace(buildSearchHref(val));
    },
    [router],
  );

  const debounceSearch = useCallback(
    (val: string) => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      timeoutId.current = setTimeout(() => {
        doSearch(val);
      }, 10);
    },
    [doSearch],
  );

  return {
    doSearch,
    debounceSearch,
    searchQuery,
    isInSearchPage,
  };
}

/** Typing goes to the URL at once; the search runs on the pauses. */
function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function useBookmarkSearch() {
  const api = useTRPC();
  const { searchQuery } = useBookmarkSearchState();
  const text = useSettled(searchQuery, 300);
  const sortOrder = useSortOrderStore((state) => state.sortOrder);

  const {
    data,
    isPending,
    isPlaceholderData,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(
    api.pictures.search.infiniteQueryOptions(
      { text, sortOrder },
      {
        placeholderData: keepPreviousData,
        gcTime: 0,
        initialCursor: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        // What's in the pictures follows once the workers have the
        // description's fingerprint.
        refetchInterval: (query) =>
          query.state.data?.pages[0]?.pictures === "preparing" ? 1500 : false,
      },
    ),
  );

  return {
    error,
    data,
    isPending,
    isPlaceholderData,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    picturesPreparing: data?.pages[0]?.pictures === "preparing",
  };
}
