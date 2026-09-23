import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";

/**
 * Fork: how each page orders what it shows — the "…" menus' Sort. Kept in the
 * account's preferences (lib/uiPreferences.tsx), only the pages changed from
 * the default, so a server-rendered page loads in the right order straight
 * away, on any device. No React in here: server pages import it.
 *
 * Page keys: "home", "favourites", "archive", "feed" (tailored feed), "tags"
 * (the tag filter), and "list:<id>", "tag:<id>", "rss:<id>" for one list,
 * tag or RSS feed.
 */

export type PageSorts = Record<string, string>;

// How many pages' choices are kept; past it, the longest-unchanged go.
const MAX_ENTRIES = 200;

export const BOOKMARK_SORTS = ["newest", "oldest", "added", "random"] as const;
export type BookmarkSort = (typeof BOOKMARK_SORTS)[number];

export const BOOKMARK_SORT_LABELS: Record<BookmarkSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  added: "Recently added",
  random: "Random",
};

/** `sorts` with one page's choice changed; `null` is back to the default. */
export function withPageSort(
  sorts: PageSorts | undefined,
  key: string,
  sort: string | null,
): PageSorts {
  // Re-added at the end: the newest choices are the ones kept.
  const entries = Object.entries(sorts ?? {}).filter(([k]) => k !== key);
  if (sort) {
    entries.push([key, sort]);
  }
  return Object.fromEntries(entries.slice(-MAX_ENTRIES));
}

export function bookmarkSortOf(
  sorts: PageSorts | undefined,
  key: string,
): BookmarkSort {
  const sort = sorts?.[key];
  return (BOOKMARK_SORTS as readonly string[]).includes(sort ?? "")
    ? (sort as BookmarkSort)
    : "newest";
}

/** A new shuffle: one per page load, so every visit reshuffles. */
export function newShuffleSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** The getBookmarks fields for a sort. */
export function bookmarkSortQuery(
  sort: BookmarkSort,
  shuffleSeed: number,
): Pick<ZGetBookmarksRequest, "sortOrder" | "sortBy" | "shuffleSeed"> {
  switch (sort) {
    case "oldest":
      return { sortOrder: "asc" };
    case "added":
      return { sortOrder: "desc", sortBy: "addedToList" };
    case "random":
      return { sortOrder: "desc", sortBy: "random", shuffleSeed };
    default:
      return { sortOrder: "desc" };
  }
}
