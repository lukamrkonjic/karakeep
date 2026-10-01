import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";

/**
 * Fork: what each page shows of its bookmarks — the "…" menus' Filter, next
 * to Sort (lib/pageSort.ts). Starred, and one kind at a time (pictures,
 * videos, links or notes). Kept in the account's preferences by the same
 * page keys as the sorts, only for pages with a filter on, so a
 * server-rendered page loads filtered straight away, on any device. No
 * React in here: server pages import it.
 */

export type PageFilters = Record<string, string[]>;

export const PAGE_FILTERS = [
  "starred",
  "pictures",
  "videos",
  "links",
  "notes",
] as const;
export type PageFilter = (typeof PAGE_FILTERS)[number];

export const PAGE_FILTER_LABELS: Record<PageFilter, string> = {
  starred: "Starred",
  pictures: "Pictures",
  videos: "Videos",
  links: "Links",
  notes: "Notes",
};

/** The kinds, one at a time. */
export const KIND_FILTERS = ["pictures", "videos", "links", "notes"] as const;

/** The kinds, as getBookmarks calls them. */
const KINDS = {
  pictures: "picture",
  videos: "video",
  links: "link",
  notes: "note",
} as const;
type KindFilter = keyof typeof KINDS;

const isKind = (filter: string): filter is KindFilter => filter in KINDS;

// How many pages' filters are kept; past it, the longest-unchanged go.
const MAX_ENTRIES = 200;

/** A page's filters: the ones still known, one kind at most, in order. */
export function pageFiltersOf(
  all: PageFilters | undefined,
  key: string,
): PageFilter[] {
  const chosen = all?.[key] ?? [];
  const kind = chosen.find(isKind);
  return PAGE_FILTERS.filter((filter) =>
    filter === "starred" ? chosen.includes(filter) : filter === kind,
  );
}

/** `all` with one page's filters changed; none is the page unfiltered. */
export function withPageFilters(
  all: PageFilters | undefined,
  key: string,
  filters: PageFilter[],
): PageFilters {
  // Re-added at the end: the newest choices are the ones kept.
  const entries = Object.entries(all ?? {}).filter(([k]) => k !== key);
  if (filters.length > 0) {
    entries.push([key, filters]);
  }
  return Object.fromEntries(entries.slice(-MAX_ENTRIES));
}

/** One filter turned on or off; a kind takes another kind's place. */
export function toggledFilter(
  filters: PageFilter[],
  filter: PageFilter,
): PageFilter[] {
  if (filters.includes(filter)) {
    return filters.filter((f) => f !== filter);
  }
  const kept = isKind(filter) ? filters.filter((f) => !isKind(f)) : filters;
  return PAGE_FILTERS.filter((f) => f === filter || kept.includes(f));
}

/** The getBookmarks fields for a page's filters. */
export function bookmarkFilterQuery(
  filters: PageFilter[],
): Pick<ZGetBookmarksRequest, "favourited" | "kind"> {
  const kind = filters.find(isKind);
  return {
    ...(filters.includes("starred") ? { favourited: true } : {}),
    ...(kind ? { kind: KINDS[kind] } : {}),
  };
}
