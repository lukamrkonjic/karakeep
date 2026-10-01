"use client";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageFilters, useSetPageFilters } from "@/lib/hooks/usePageFilter";
import {
  KIND_FILTERS,
  PAGE_FILTER_LABELS,
  toggledFilter,
} from "@/lib/pageFilter";
import type { PageFilter } from "@/lib/pageFilter";
import { ListFilter } from "lucide-react";

/**
 * Fork: "Filter: …" inside a "…" menu, under Sort — Starred, and one kind
 * at a time (pictures, videos, links, notes). The choice is the page's own
 * and is kept (lib/pageFilter.ts); what's on shows as chips over the grid
 * (PageFilterChips), each with its ×. Ticking keeps the menu open.
 */
export function BookmarkFilterSubmenu({
  pageKey,
  withStarred = true,
}: {
  pageKey: string;
  /** Not on Favourites, where everything is. */
  withStarred?: boolean;
}) {
  const filters = usePageFilters(pageKey);
  const setFilters = useSetPageFilters();
  const toggle = (filter: PageFilter) =>
    void setFilters(pageKey, toggledFilter(filters, filter));
  const item = (filter: PageFilter) => (
    <DropdownMenuCheckboxItem
      key={filter}
      checked={filters.includes(filter)}
      onSelect={(e) => e.preventDefault()}
      onCheckedChange={() => toggle(filter)}
    >
      {PAGE_FILTER_LABELS[filter]}
    </DropdownMenuCheckboxItem>
  );
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex gap-2">
        <ListFilter className="size-4" />
        <span>
          Filter:{" "}
          {filters.length > 0
            ? filters.map((f) => PAGE_FILTER_LABELS[f]).join(", ")
            : "None"}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {withStarred && (
            <>
              {item("starred")}
              <DropdownMenuSeparator />
            </>
          )}
          {KIND_FILTERS.map(item)}
          {filters.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void setFilters(pageKey, [])}>
                Show everything
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
