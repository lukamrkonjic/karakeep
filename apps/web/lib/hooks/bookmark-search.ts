import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClientConfig } from "@/lib/clientConfig";
import { useSortOrderStore } from "@/lib/store/useSortOrderStore";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import type { ZBookmarkSearchMode } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";

import { useInSearchPageStore } from "../store/useInSearchPageStore";

const DEFAULT_SEARCH_MODE: ZBookmarkSearchMode = "fts";

/**
 * Fork: "pictures" — pictures found by describing them (Settings →
 * Pictures). The web app's own mode: the search page shows it with
 * PictureSearchResults instead of searchBookmarks.
 */
export type SearchMode = ZBookmarkSearchMode | "pictures";

function parseSearchMode(value: string | null): SearchMode {
  if (value === "semantic" || value === "hybrid" || value === "pictures") {
    return value;
  }
  return DEFAULT_SEARCH_MODE;
}

function buildSearchHref(query: string, mode: SearchMode) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (mode !== DEFAULT_SEARCH_MODE) {
    params.set("mode", mode);
  }
  const queryString = params.toString();
  return `/dashboard/search${queryString ? `?${queryString}` : ""}`;
}

export function useBookmarkSearchState() {
  const { semanticSearchEnabled } = useClientConfig().search;
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const searchMode = parseSearchMode(searchParams.get("mode"));
  const pathname = usePathname();
  const lastSearch = useRef({ searchQuery, searchMode });

  // Only update the effective search state when on the search page.
  // This prevents the query or mode from resetting when intercepting routes
  // change the URL (e.g., opening a bookmark preview dialog).
  if (pathname.startsWith("/dashboard/search")) {
    lastSearch.current = { searchQuery, searchMode };
  }

  const effectiveSearch = lastSearch.current;
  const parsed = useMemo(
    () => parseSearchQuery(effectiveSearch.searchQuery),
    [effectiveSearch.searchQuery],
  );
  const selectedSearchMode: SearchMode =
    semanticSearchEnabled || effectiveSearch.searchMode === "pictures"
      ? effectiveSearch.searchMode
      : DEFAULT_SEARCH_MODE;

  // A query with no text (e.g. one made up entirely of qualifiers like
  // `is:fav`) has nothing to embed, so it can only be served by full-text
  // search. Keep the selected mode around for the UI, but search with fts.
  const hasQueryText = parsed.text.trim().length > 0;

  return {
    searchQuery: effectiveSearch.searchQuery,
    searchMode: selectedSearchMode,
    effectiveSearchMode:
      hasQueryText && selectedSearchMode !== "pictures"
        ? selectedSearchMode
        : DEFAULT_SEARCH_MODE,
    parsedSearchQuery: parsed,
  };
}

export function useDoBookmarkSearch() {
  const router = useRouter();
  const { searchQuery, searchMode } = useBookmarkSearchState();
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

  const navigateToSearch = useCallback(
    (query: string, mode: SearchMode) => {
      router.replace(buildSearchHref(query, mode));
    },
    [router],
  );

  const doSearch = useCallback(
    (val: string) => {
      timeoutId.current = null;
      navigateToSearch(val, searchMode);
    },
    [navigateToSearch, searchMode],
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

  const setSearchMode = useCallback(
    (mode: SearchMode, query = searchQuery) => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
        timeoutId.current = null;
      }
      navigateToSearch(query, mode);
    },
    [navigateToSearch, searchQuery],
  );

  return {
    doSearch,
    debounceSearch,
    setSearchMode,
    searchQuery,
    searchMode,
    isInSearchPage,
  };
}

export function useBookmarkSearch() {
  const api = useTRPC();
  const { searchQuery, effectiveSearchMode } = useBookmarkSearchState();
  const sortOrder = useSortOrderStore((state) => state.sortOrder);
  const effectiveSortOrder =
    effectiveSearchMode === "fts" ? sortOrder : ("relevance" as const);

  const {
    data,
    isPending,
    isPlaceholderData,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(
    api.bookmarks.searchBookmarks.infiniteQueryOptions(
      {
        text: searchQuery,
        searchMode: effectiveSearchMode,
        sortOrder: effectiveSortOrder,
      },
      {
        placeholderData: keepPreviousData,
        gcTime: 0,
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
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
  };
}
