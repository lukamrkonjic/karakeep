"use client";

import { Suspense, useEffect } from "react";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { useBookmarkSearch } from "@/lib/hooks/bookmark-search";
import { useInSearchPageStore } from "@/lib/store/useInSearchPageStore";
import { useSortOrderStore } from "@/lib/store/useSortOrderStore";
import { Loader2 } from "lucide-react";

function SearchComp() {
  const {
    data,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    picturesPreparing,
  } = useBookmarkSearch();

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

  const bookmarks = data?.pages.flatMap((b) => b.bookmarks);
  return (
    <div className="flex flex-col gap-3">
      {/* Fork: one search (routers/pictures.ts search) — what's in the
          pictures joins in once the workers have the description's
          fingerprint (the first time, the text model downloads). */}
      {picturesPreparing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Looking in the pictures too…
        </p>
      )}
      {!bookmarks ? (
        <BookmarksGridSkeleton />
      ) : bookmarks.length > 0 || !picturesPreparing ? (
        <BookmarksGrid
          hasNextPage={hasNextPage}
          fetchNextPage={fetchNextPage}
          isFetchingNextPage={isFetchingNextPage}
          bookmarks={bookmarks}
        />
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchComp />
    </Suspense>
  );
}
