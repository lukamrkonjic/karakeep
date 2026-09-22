import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import {
  bookmarkSortOf,
  bookmarkSortQuery,
  newShuffleSeed,
  PAGE_SORT_COOKIE,
  parsePageSorts,
} from "@/lib/pageSort";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";

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
   * Fork: which page this is, for its "…" menu's Sort (lib/pageSort.ts). The
   * choice comes from a cookie, so the first page is already in that order;
   * Random gets a new shuffle on every load.
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

  const sort = bookmarkSortQuery(
    bookmarkSortOf(
      parsePageSorts((await cookies()).get(PAGE_SORT_COOKIE)?.value),
      sortKey,
    ),
    newShuffleSeed(),
  );
  const bookmarks = await api.bookmarks.getBookmarks({
    ...query,
    ...sort,
  });

  return (
    <div className="flex flex-col gap-3">
      {header}
      {showDivider && <Separator />}
      <UpdatableBookmarksGrid
        // A new order (or a new shuffle) starts a fresh grid.
        key={JSON.stringify(sort)}
        query={query}
        sort={sort}
        bookmarks={bookmarks}
        showEditorCard={showEditorCard}
      />
    </div>
  );
}
