"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n/client";
import { startSelection } from "@/lib/selection";
import { useInBookmarkGridStore } from "@/lib/store/useInBookmarkGridStore";
import { cn } from "@/lib/utils";
import { CircleCheck, MoreHorizontal } from "lucide-react";

import { BookmarkSortSubmenu } from "./sort/SortSubmenu";

/**
 * Fork: "Select" — select mode on the page's cards (lib/selection.ts), first
 * in a page's "…". Only while the page shows a grid of bookmarks, and only
 * in the "…" of the page you're on (`current`).
 */
export function SelectMenuItem({ current = true }: { current?: boolean }) {
  const { t } = useTranslation();
  const inBookmarkGrid = useInBookmarkGridStore(
    (state) => state.inBookmarkGrid,
  );
  if (!current || !inBookmarkGrid) {
    return null;
  }
  return (
    <DropdownMenuItem className="flex gap-2" onClick={() => startSelection()}>
      <CircleCheck className="size-4" />
      <span>{t("actions.select")}</span>
    </DropdownMenuItem>
  );
}

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
  path,
}: {
  variant: "sidebar" | "header";
  /** What the button is called, e.g. "Tailored feed options". */
  label: string;
  items?: PageOptionsItem[];
  /** The page's Sort submenu (components/dashboard/sort/SortSubmenu.tsx). */
  sort: React.ReactNode;
  /** The page's address: the sidebar's "…" offers Select only there. */
  path?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
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
        <SelectMenuItem current={variant === "header" || pathname === path} />
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
  path,
}: {
  variant: "sidebar" | "header";
  label: string;
  pageKey: string;
  path?: string;
}) {
  return (
    <PageOptions
      variant={variant}
      label={label}
      sort={<BookmarkSortSubmenu pageKey={pageKey} />}
      path={path}
    />
  );
}
