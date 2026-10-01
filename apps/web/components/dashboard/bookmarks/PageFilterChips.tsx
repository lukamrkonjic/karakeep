"use client";

import { usePageFilters, useSetPageFilters } from "@/lib/hooks/usePageFilter";
import { PAGE_FILTER_LABELS } from "@/lib/pageFilter";
import type { PageFilter } from "@/lib/pageFilter";
import type { LucideIcon } from "lucide-react";
import { FileText, Film, Image, Link2, Star, X } from "lucide-react";

const ICONS: Record<PageFilter, LucideIcon> = {
  starred: Star,
  pictures: Image,
  videos: Film,
  links: Link2,
  notes: FileText,
};

/**
 * Fork: a page's filters (its "…" → Filter, lib/pageFilter.ts) over its
 * grid, so a filtered page never passes for the whole of it: a chip each,
 * whose × takes it off.
 */
export default function PageFilterChips({ pageKey }: { pageKey: string }) {
  const filters = usePageFilters(pageKey);
  const setFilters = useSetPageFilters();
  if (filters.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => {
        const Icon = ICONS[filter];
        const label = PAGE_FILTER_LABELS[filter];
        return (
          <span
            key={filter}
            className="flex h-7 items-center gap-1.5 rounded-full border bg-muted/50 pl-2.5 pr-1 text-sm"
          >
            <Icon
              className={
                filter === "starred"
                  ? "size-3.5 fill-amber-400 text-amber-400"
                  : "size-3.5 text-muted-foreground"
              }
            />
            {label}
            <button
              type="button"
              title="Take this filter off"
              aria-label={`Take the ${label} filter off`}
              onClick={() =>
                void setFilters(
                  pageKey,
                  filters.filter((f) => f !== filter),
                )
              }
              className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
