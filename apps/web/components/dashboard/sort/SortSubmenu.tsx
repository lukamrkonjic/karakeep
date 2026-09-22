"use client";

import {
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageSorts, useSetPageSort } from "@/lib/hooks/usePageSort";
import {
  BOOKMARK_SORT_LABELS,
  bookmarkSortOf,
  LIST_SORT_LABELS,
  LIST_SORTS,
  listSortOf,
} from "@/lib/pageSort";
import type { BookmarkSort } from "@/lib/pageSort";
import { ArrowUpDown } from "lucide-react";

/**
 * Fork: "Sort: …" inside a "…" menu. The choice is this page's own and is
 * kept (lib/pageSort.ts); Random reshuffles on every visit.
 */
function SortSubmenu<T extends string>({
  current,
  options,
  labels,
  onPick,
}: {
  current: T;
  options: readonly T[];
  labels: Record<T, string>;
  onPick: (sort: T) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex gap-2">
        <ArrowUpDown className="size-4" />
        <span>Sort: {labels[current]}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={current}
            onValueChange={(value) => onPick(value as T)}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {labels[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/** How a page orders its bookmarks. "Recently added" only where it's a list. */
export function BookmarkSortSubmenu({
  pageKey,
  withRecentlyAdded = false,
}: {
  pageKey: string;
  withRecentlyAdded?: boolean;
}) {
  const setSort = useSetPageSort();
  const current = bookmarkSortOf(usePageSorts(), pageKey);
  const options: BookmarkSort[] = withRecentlyAdded
    ? ["newest", "oldest", "added", "random"]
    : ["newest", "oldest", "random"];
  return (
    <SortSubmenu
      current={current}
      options={options}
      labels={BOOKMARK_SORT_LABELS}
      onPick={(sort) => setSort(pageKey, sort === "newest" ? null : sort)}
    />
  );
}

/** How the All Lists page orders the lists. */
export function ListSortSubmenu() {
  const setSort = useSetPageSort();
  const current = listSortOf(usePageSorts());
  return (
    <SortSubmenu
      current={current}
      options={LIST_SORTS}
      labels={LIST_SORT_LABELS}
      onPick={(sort) => setSort("lists", sort === "custom" ? null : sort)}
    />
  );
}
