"use client";

import { ButtonWithTooltip } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageFilters } from "@/lib/hooks/usePageFilter";
import { usePageSorts, useSetPageSort } from "@/lib/hooks/usePageSort";
import { PAGE_FILTER_LABELS } from "@/lib/pageFilter";
import { BOOKMARK_SORT_LABELS, bookmarkSortOf } from "@/lib/pageSort";
import { Palette, Shuffle, SortAsc, SortDesc } from "lucide-react";

import { BookmarkFilterSubmenu } from "./FilterSubmenu";

/**
 * Fork: the header's sort button for a page with no header of its own to
 * hang a "…" on — the home feed. Same choices and memory as the menus', and
 * their Filter under them.
 */
export function PageSortButton({ pageKey }: { pageKey: string }) {
  const setSort = useSetPageSort();
  const current = bookmarkSortOf(usePageSorts(), pageKey);
  const filters = usePageFilters(pageKey);
  const Icon =
    current === "oldest"
      ? SortAsc
      : current === "random"
        ? Shuffle
        : current === "colour"
          ? Palette
          : SortDesc;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ButtonWithTooltip
          tooltip={`Sort: ${BOOKMARK_SORT_LABELS[current]}${
            filters.length > 0
              ? ` · Filter: ${filters.map((f) => PAGE_FILTER_LABELS[f]).join(", ")}`
              : ""
          }`}
          delayDuration={100}
          variant="ghost"
        >
          <Icon size={18} />
        </ButtonWithTooltip>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-fit">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(sort) =>
            void setSort(pageKey, sort === "newest" ? null : sort)
          }
        >
          {(["newest", "oldest", "random", "colour"] as const).map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {BOOKMARK_SORT_LABELS[sort]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <BookmarkFilterSubmenu pageKey={pageKey} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
