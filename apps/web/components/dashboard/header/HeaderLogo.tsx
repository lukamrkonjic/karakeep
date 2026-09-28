"use client";

import Link from "next/link";
import KarakeepLogo from "@/components/KarakeepIcon";
import SidebarCollapseToggle from "@/components/shared/sidebar/SidebarCollapseToggle";
import { useSidebarCollapsed } from "@/lib/sidebarCollapse";
import { cn } from "@/lib/utils";

/**
 * Fork: the header's left end on a desktop — the logo, then the sidebar
 * button. With the sidebar open it's as wide as the sidebar, the button at
 * its right end. Folding the sidebar folds this at the same pace
 * (SidebarCollapseWrapper), so the button rides the sidebar's edge until it
 * reaches the logo (min-w-max), and the search bar follows it.
 */
export default function HeaderLogo() {
  const collapsed = useSidebarCollapsed();
  return (
    <div
      className={cn(
        // In the Mac app, right of the window's buttons (at about 14–76px): the
        // gap narrower, so it still fits the 240px sidebar.
        "hidden min-w-max shrink-0 items-center justify-between gap-3 pl-4 transition-[width] duration-200 ease-in-out mac-app:gap-2 mac-app:pl-[88px] sm:flex",
        collapsed ? "w-0" : "w-60 xl:w-72",
      )}
    >
      <Link
        href="/dashboard/bookmarks"
        aria-label="Home"
        className="transition-opacity hover:opacity-70"
      >
        <KarakeepLogo height={38} />
      </Link>
      {/* Open, in line with the sidebar's New list +, which sits inside the
          aside's p-4, the lists' heading's scrollbar gutter (6px where the
          browser reserves one, none where its scrollbars float) and the
          buttons' mr-1 — the same three here, so the two line up in any
          browser (AllLists.tsx). Folded, there's no p-4 to match. */}
      <div
        className={cn(
          "sidebar-scrollbar overflow-hidden transition-[margin] duration-200 ease-in-out [scrollbar-gutter:stable]",
          collapsed ? "mr-0" : "mr-4",
        )}
      >
        <SidebarCollapseToggle className="mr-1 block" />
      </div>
    </div>
  );
}
