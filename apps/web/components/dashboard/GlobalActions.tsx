"use client";

import { usePathname } from "next/navigation";
import BulkBookmarksAction from "@/components/dashboard/BulkBookmarksAction";
import NewBookmarkDialog from "@/components/dashboard/bookmarks/NewBookmarkDialog";
import SortOrderToggle from "@/components/dashboard/SortOrderToggle";
import { PageSortButton } from "@/components/dashboard/sort/PageSortButton";
import ViewOptions from "@/components/dashboard/ViewOptions";
import { useInBookmarkGridStore } from "@/lib/store/useInBookmarkGridStore";

export default function GlobalActions() {
  const inBookmarkGrid = useInBookmarkGridStore(
    (state) => state.inBookmarkGrid,
  );
  // Fork: every other page sorts from its own "…" menu (lib/pageSort.ts).
  // Search keeps upstream's toggle (it has relevance); the home feed has no
  // header of its own, so its sort stays up here.
  const pathname = usePathname();
  const onSearch = pathname.startsWith("/dashboard/search");
  const onHome = pathname === "/dashboard/bookmarks";
  return (
    <div className="flex min-w-max shrink-0 overflow-hidden">
      {inBookmarkGrid && <NewBookmarkDialog />}
      {inBookmarkGrid && <ViewOptions />}
      {inBookmarkGrid && <BulkBookmarksAction />}
      {inBookmarkGrid && onSearch && <SortOrderToggle />}
      {inBookmarkGrid && onHome && <PageSortButton pageKey="home" />}
    </div>
  );
}
