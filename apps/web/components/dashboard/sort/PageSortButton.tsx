"use client";

import { ButtonWithTooltip } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageSorts, useSetPageSort } from "@/lib/hooks/usePageSort";
import { BOOKMARK_SORT_LABELS, bookmarkSortOf } from "@/lib/pageSort";
import { Shuffle, SortAsc, SortDesc } from "lucide-react";

/**
 * Fork: the header's sort button for a page with no header of its own to
 * hang a "…" on — the home feed. Same choices and memory as the menus'.
 */
export function PageSortButton({ pageKey }: { pageKey: string }) {
  const setSort = useSetPageSort();
  const current = bookmarkSortOf(usePageSorts(), pageKey);
  const Icon =
    current === "oldest" ? SortAsc : current === "random" ? Shuffle : SortDesc;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ButtonWithTooltip
          tooltip={`Sort: ${BOOKMARK_SORT_LABELS[current]}`}
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
            setSort(pageKey, sort === "newest" ? null : sort)
          }
        >
          {(["newest", "oldest", "random"] as const).map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {BOOKMARK_SORT_LABELS[sort]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
