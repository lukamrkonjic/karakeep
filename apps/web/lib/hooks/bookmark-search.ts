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
 * is just left out. The lists it's within (the search bar's chips) are
 * ?in=<id>,<id>.
 */
function buildSearchHref(query: string, listIds: string[] = []) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (listIds.length > 0) {
    params.set("in", listIds.join(","));
  }
  const queryString = params.toString();
  return `/dashboard/search${queryString ? `?${queryString}` : ""}`;
}

/**
 * Fork: a query within lists (any of them, and what's under them) as one
 * query — for a smart list saved from the search bar. `query` must parse in
 * full (the parentheses keep its "or"s inside).
 */
export function queryWithinLists(query: string, listIds: string[]) {
  if (listIds.length === 0) {
    return query;
  }
  const lists = listIds.map((id) => `listid:${id}`);
  const scope = lists.length === 1 ? lists[0] : `(${lists.join(" or ")})`;
  return query.trim() ? `${scope} (${query.trim()})` : scope;
}

export function useBookmarkSearchState() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const searchIn = searchParams.get("in") ?? "";
  const pathname = usePathname();
  const lastSearch = useRef(searchQuery);
  const lastIn = useRef(searchIn);

  // Only update the effective search state when on the search page.
  // This prevents the query from resetting when intercepting routes change
  // the URL (e.g., opening a bookmark preview dialog).
  if (pathname.startsWith("/dashboard/search")) {
    lastSearch.current = searchQuery;
    lastIn.current = searchIn;
  }

  const effectiveQuery = lastSearch.current;
  const effectiveIn = lastIn.current;
  const parsed = useMemo(
    () => parseSearchQuery(effectiveQuery),
    [effectiveQuery],
  );
  const searchScope = useMemo(
    () => effectiveIn.split(",").filter(Boolean),
    [effectiveIn],
  );

  return {
    searchQuery: effectiveQuery,
    parsedSearchQuery: parsed,
    /** Fork: the lists it's within (none: everywhere). */
    searchScope,
  };
}

export function useDoBookmarkSearch() {
  const router = useRouter();
  const { searchQuery, searchScope } = useBookmarkSearchState();
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
    (val: string, listIds: string[] = []) => {
      timeoutId.current = null;
      router.replace(buildSearchHref(val, listIds));
    },
    [router],
  );

  const debounceSearch = useCallback(
    (val: string, listIds: string[] = []) => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      timeoutId.current = setTimeout(() => {
        doSearch(val, listIds);
      }, 10);
    },
    [doSearch],
  );

  return {
    doSearch,
    debounceSearch,
    searchQuery,
    searchScope,
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
  const { searchQuery, searchScope } = useBookmarkSearchState();
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
      {
        text,
        listIds: searchScope.length > 0 ? searchScope : undefined,
        sortOrder,
      },
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
