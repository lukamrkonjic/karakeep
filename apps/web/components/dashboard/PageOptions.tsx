"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";

import { BookmarkSortSubmenu } from "./sort/SortSubmenu";

export interface PageOptionsItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

/**
 * Fork: the "…" menu of a page that isn't a list — All Lists, Tailored feed,
 * Tags, Favourites, Archive, a tag, an RSS feed — in the sidebar (shown on
 * hover, where a list's "…" sits) and in the page's own header. Lists keep
 * their ListOptions; both carry the same Sort submenu.
 */
export function PageOptions({
  variant,
  label,
  items = [],
  sort,
}: {
  variant: "sidebar" | "header";
  /** What the button is called, e.g. "Tailored feed options". */
  label: string;
  items?: PageOptionsItem[];
  /** The page's Sort submenu (components/dashboard/sort/SortSubmenu.tsx). */
  sort: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <Button
            size="none"
            variant="ghost"
            className="relative"
            aria-label={label}
            title={label}
          >
            {/* Right-aligned in the slot where a list shows its count, the
                same as a list row's "…", so they all line up. */}
            <MoreHorizontal
              className={cn(
                "absolute inset-y-0 right-2.5 my-auto size-4 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100",
                open ? "opacity-100" : "opacity-0",
              )}
            />
            <span aria-hidden className="invisible px-2.5 text-xs font-light">
              00
            </span>
          </Button>
        ) : (
          <Button variant="ghost" aria-label={label} title={label}>
            <MoreHorizontal />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === "header" ? "end" : "start"}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className="flex gap-2"
            onClick={item.onSelect}
          >
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuItem>
        ))}
        {sort}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A page whose "…" only sorts its bookmarks; plain props, so server pages can use it. */
export function BookmarkPageOptions({
  variant,
  label,
  pageKey,
}: {
  variant: "sidebar" | "header";
  label: string;
  pageKey: string;
}) {
  return (
    <PageOptions
      variant={variant}
      label={label}
      sort={<BookmarkSortSubmenu pageKey={pageKey} />}
    />
  );
}
