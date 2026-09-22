import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";

/**
 * Fork: how each page orders what it shows — the "…" menus' Sort. One cookie
 * holds every page's choice (only the ones changed from the default), so a
 * server-rendered page loads in the right order straight away instead of
 * flashing newest-first. No React in here: server pages import it.
 *
 * Page keys: "home", "favourites", "archive", "feed" (tailored feed), "tags"
 * (the tag filter), "lists" (the All Lists page), and "list:<id>",
 * "tag:<id>", "rss:<id>" for one list, tag or RSS feed.
 */
export const PAGE_SORT_COOKIE = "karakeep-sort";

// How many pages' choices the cookie keeps (it must stay under 4 KB).
const MAX_ENTRIES = 100;

export const BOOKMARK_SORTS = ["newest", "oldest", "added", "random"] as const;
export type BookmarkSort = (typeof BOOKMARK_SORTS)[number];

export const BOOKMARK_SORT_LABELS: Record<BookmarkSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  added: "Recently added",
  random: "Random",
};

/** The All Lists page sorts lists, not bookmarks. */
export const LIST_SORTS = ["custom", "name", "size", "random"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const LIST_SORT_LABELS: Record<ListSort, string> = {
  custom: "Your order",
  name: "Name (A–Z)",
  size: "Most items",
  random: "Random",
};

/** "list:abc=random|feed=oldest" → { "list:abc": "random", feed: "oldest" } */
export function parsePageSorts(value?: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (value ?? "").split("|")) {
    const at = entry.lastIndexOf("=");
    if (at > 0) {
      out.set(entry.slice(0, at), entry.slice(at + 1));
    }
  }
  return out;
}

export function serializePageSorts(sorts: Map<string, string>): string {
  // The newest choices are last; past the cap, the oldest go.
  return [...sorts]
    .slice(-MAX_ENTRIES)
    .map(([key, sort]) => `${key}=${sort}`)
    .join("|");
}

export function bookmarkSortOf(
  sorts: Map<string, string>,
  key: string,
): BookmarkSort {
  const sort = sorts.get(key);
  return (BOOKMARK_SORTS as readonly string[]).includes(sort ?? "")
    ? (sort as BookmarkSort)
    : "newest";
}

export function listSortOf(sorts: Map<string, string>): ListSort {
  const sort = sorts.get("lists");
  return (LIST_SORTS as readonly string[]).includes(sort ?? "")
    ? (sort as ListSort)
    : "custom";
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
