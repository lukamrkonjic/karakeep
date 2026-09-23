"use client";

import { useMemo, useState } from "react";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { usePageSorts } from "@/lib/hooks/usePageSort";
import {
  bookmarkSortOf,
  bookmarkSortQuery,
  newShuffleSeed,
} from "@/lib/pageSort";
import { useQuery } from "@tanstack/react-query";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";

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
 * (lib/pageSort.ts); Random reshuffles each time the page opens.
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

  const { data } = useQuery(
    api.bookmarks.getBookmarks.queryOptions({ ...query, ...sort }),
  );

  if (!data) {
    return <FullPageSpinner />;
  }
  // Keyed on the query and order so a new choice starts a fresh grid rather
  // than appending pages of the old one.
  return (
    <UpdatableBookmarksGrid
      key={JSON.stringify({ query, sort })}
      query={query}
      sort={sort}
      bookmarks={data}
    />
  );
}
