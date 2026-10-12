import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { bookmarkFilterQuery, pageFiltersOf } from "@/lib/pageFilter";
import {
  bookmarkSortOf,
  bookmarkSortQuery,
  newShuffleSeed,
} from "@/lib/pageSort";
import { getUiPreferences } from "@/lib/uiPreferences.server";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";

import PageFilterChips from "./PageFilterChips";
import UpdatableBookmarksGrid from "./UpdatableBookmarksGrid";

export default async function Bookmarks({
  query,
  sortKey,
  header,
  showDivider,
  showEditorCard = false,
}: {
  query: Omit<
    ZGetBookmarksRequest,
    "sortOrder" | "sortBy" | "shuffleSeed" | "includeContent"
  >;
  /**
   * Fork: which page this is, for its "…" menu's Sort (lib/pageSort.ts) and
   * Filter (lib/pageFilter.ts). Both are account preferences, so the first
   * page is already in that order and filtered; Random gets a new shuffle
   * on every load.
   */
  sortKey: string;
  header?: React.ReactNode;
  showDivider?: boolean;
  showEditorCard?: boolean;
}) {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  const prefs = await getUiPreferences();
  const sort = bookmarkSortQuery(
    bookmarkSortOf(prefs.pageSorts, sortKey),
    newShuffleSeed(),
  );
  const filters = pageFiltersOf(prefs.pageFilters, sortKey);
  const filtered = { ...query, ...bookmarkFilterQuery(filters) };
  const bookmarks = await api.bookmarks.getBookmarks({
    ...filtered,
    ...sort,
  });

  return (
    <div className="flex flex-col gap-3">
      {header}
      {showDivider && <Separator />}
      <PageFilterChips pageKey={sortKey} />
      <UpdatableBookmarksGrid
        // A new order (or a new shuffle), or filter, starts a fresh grid.
        key={JSON.stringify({ sort, filters })}
        query={filtered}
        sort={sort}
        bookmarks={bookmarks}
        showEditorCard={showEditorCard}
      />
    </div>
  );
}
