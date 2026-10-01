"use client";

import { useMemo, useState } from "react";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { usePageFilters } from "@/lib/hooks/usePageFilter";
import { usePageSorts } from "@/lib/hooks/usePageSort";
import { bookmarkFilterQuery } from "@/lib/pageFilter";
import {
  bookmarkSortOf,
  bookmarkSortQuery,
  newShuffleSeed,
} from "@/lib/pageSort";
import { useQuery } from "@tanstack/react-query";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";

import PageFilterChips from "./PageFilterChips";
import UpdatableBookmarksGrid from "./UpdatableBookmarksGrid";

type Query = Omit<
  ZGetBookmarksRequest,
  "sortOrder" | "sortBy" | "shuffleSeed" | "includeContent"
>;

/**
 * UpdatableBookmarksGrid for pages whose query only exists in the browser
 * (the tailored feed's list choice, the tag filter): fetches the first page
 * here instead of on the server, then hands over to the usual grid, which
 * takes pagination from there. `sortKey` is the page's "…" menu Sort
 * (lib/pageSort.ts) and Filter (lib/pageFilter.ts); Random reshuffles each
 * time the page opens.
 */
export default function ClientBookmarksGrid({
  query,
  sortKey,
}: {
  query: Query;
  sortKey: string;
}) {
  const api = useTRPC();
  const [seed] = useState(newShuffleSeed);
  const sortChoice = bookmarkSortOf(usePageSorts(), sortKey);
  const sort = useMemo(
    () => bookmarkSortQuery(sortChoice, seed),
    [sortChoice, seed],
  );
  const filters = usePageFilters(sortKey);
  const filtered = useMemo(
    () => ({ ...query, ...bookmarkFilterQuery(filters) }),
    [query, filters],
  );

  const { data } = useQuery(
    api.bookmarks.getBookmarks.queryOptions({ ...filtered, ...sort }),
  );

  if (!data) {
    return <FullPageSpinner />;
  }
  // Keyed on the query and order so a new choice starts a fresh grid rather
  // than appending pages of the old one.
  return (
    <div className="flex flex-col gap-3">
      <PageFilterChips pageKey={sortKey} />
      <UpdatableBookmarksGrid
        key={JSON.stringify({ filtered, sort })}
        query={filtered}
        sort={sort}
        bookmarks={data}
      />
    </div>
  );
}
