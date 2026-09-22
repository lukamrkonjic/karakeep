"use client";

import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { useQuery } from "@tanstack/react-query";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";

import UpdatableBookmarksGrid from "./UpdatableBookmarksGrid";

type Query = Omit<ZGetBookmarksRequest, "sortOrder" | "includeContent">;

/**
 * UpdatableBookmarksGrid for pages whose query only exists in the browser
 * (the tailored feed's list choice, the tag filter): fetches the first page
 * here instead of on the server, then hands over to the usual grid, which
 * takes pagination and sort order from there.
 */
export default function ClientBookmarksGrid({ query }: { query: Query }) {
  const api = useTRPC();
  const { data } = useQuery(api.bookmarks.getBookmarks.queryOptions(query));

  if (!data) {
    return <FullPageSpinner />;
  }
  // Keyed on the query so a new choice starts a fresh grid rather than
  // appending pages of the old one.
  return (
    <UpdatableBookmarksGrid
      key={JSON.stringify(query)}
      query={query}
      bookmarks={data}
    />
  );
}
