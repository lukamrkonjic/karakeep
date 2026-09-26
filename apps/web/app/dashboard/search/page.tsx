"use client";

import { Suspense, useEffect } from "react";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { PictureSearchResults } from "@/components/dashboard/pictures/PictureSearchResults";
import {
  useBookmarkSearch,
  useBookmarkSearchState,
} from "@/lib/hooks/bookmark-search";
import { useInSearchPageStore } from "@/lib/store/useInSearchPageStore";
import { useSortOrderStore } from "@/lib/store/useSortOrderStore";

function SearchComp() {
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useBookmarkSearch();

  const { setInSearchPage } = useInSearchPageStore();

  const { setSortOrder } = useSortOrderStore();

  useEffect(() => {
    // also see related cleanup code in SortOrderToggle.tsx
    setSortOrder("relevance");
  }, [setSortOrder]);

  useEffect(() => {
    setInSearchPage(true);
    return () => setInSearchPage(false);
  }, [setInSearchPage]);

  if (error) {
    throw error;
  }

  return (
    <div className="flex flex-col gap-3">
      {data ? (
        <BookmarksGrid
          hasNextPage={hasNextPage}
          fetchNextPage={fetchNextPage}
          isFetchingNextPage={isFetchingNextPage}
          bookmarks={data.pages.flatMap((b) => b.bookmarks)}
        />
      ) : (
        <BookmarksGridSkeleton />
      )}
    </div>
  );
}

/** Fork: Search → Pictures has results of its own (by description). */
function SearchResults() {
  const { searchMode, searchQuery } = useBookmarkSearchState();
  const { setInSearchPage } = useInSearchPageStore();
  useEffect(() => {
    setInSearchPage(true);
    return () => setInSearchPage(false);
  }, [setInSearchPage]);
  return searchMode === "pictures" ? (
    <PictureSearchResults query={searchQuery} />
  ) : (
    <SearchComp />
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
