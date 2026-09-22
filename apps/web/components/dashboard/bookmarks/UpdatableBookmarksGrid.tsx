"use client";

import { useEffect } from "react";
import UploadDropzone from "@/components/dashboard/UploadDropzone";
import { useSortOrderStore } from "@/lib/store/useSortOrderStore";
import { useInfiniteQuery } from "@tanstack/react-query";

import type {
  ZGetBookmarksRequest,
  ZGetBookmarksResponse,
} from "@karakeep/shared/types/bookmarks";
import { BookmarkGridContextProvider } from "@karakeep/shared-react/hooks/bookmark-grid-context";
import { useTRPC } from "@karakeep/shared-react/trpc";

import BookmarksGrid from "./BookmarksGrid";

type SortFields = "sortOrder" | "sortBy" | "shuffleSeed";

export default function UpdatableBookmarksGrid({
  query,
  sort,
  bookmarks: initialBookmarks,
  showEditorCard = false,
}: {
  query: Omit<ZGetBookmarksRequest, SortFields | "includeContent">;
  /**
   * Fork: the page's own sort (its "…" menu, lib/pageSort.ts). The initial
   * bookmarks must have been loaded with it. Without one, the header's
   * global sort toggle applies, as upstream.
   */
  sort?: Pick<ZGetBookmarksRequest, SortFields>;
  bookmarks: ZGetBookmarksResponse;
  showEditorCard?: boolean;
  itemsPerPage?: number;
}) {
  const api = useTRPC();
  let sortOrder = useSortOrderStore((state) => state.sortOrder);
  if (sortOrder === "relevance") {
    // Relevance is not supported in the `getBookmarks` endpoint.
    sortOrder = "desc";
  }

  const finalQuery = {
    ...query,
    ...(sort ?? { sortOrder }),
    includeContent: false,
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery(
      api.bookmarks.getBookmarks.infiniteQueryOptions(
        { ...finalQuery, useCursorV2: true },
        {
          initialData: () => ({
            pages: [initialBookmarks],
            pageParams: [query.cursor ?? null],
          }),
          initialCursor: null,
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          refetchOnMount: true,
        },
      ),
    );

  const followsGlobalToggle = sort === undefined;
  useEffect(() => {
    if (followsGlobalToggle) {
      refetch();
    }
  }, [sortOrder, refetch, followsGlobalToggle]);

  const grid = (
    <BookmarksGrid
      bookmarks={data.pages.flatMap((b) => b.bookmarks)}
      hasNextPage={hasNextPage}
      fetchNextPage={fetchNextPage}
      isFetchingNextPage={isFetchingNextPage}
      showEditorCard={showEditorCard}
    />
  );

  return (
    <BookmarkGridContextProvider query={finalQuery}>
      {showEditorCard ? <UploadDropzone>{grid}</UploadDropzone> : grid}
    </BookmarkGridContextProvider>
  );
}
