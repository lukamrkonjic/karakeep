"use client";

import BulkBookmarksAction from "@/components/dashboard/BulkBookmarksAction";
import NewBookmarkDialog from "@/components/dashboard/bookmarks/NewBookmarkDialog";
import SortOrderToggle from "@/components/dashboard/SortOrderToggle";
import ViewOptions from "@/components/dashboard/ViewOptions";
import { useInBookmarkGridStore } from "@/lib/store/useInBookmarkGridStore";

export default function GlobalActions() {
  const inBookmarkGrid = useInBookmarkGridStore(
    (state) => state.inBookmarkGrid,
  );
  return (
    <div className="flex min-w-max shrink-0 overflow-hidden">
      {inBookmarkGrid && <NewBookmarkDialog />}
      {inBookmarkGrid && <ViewOptions />}
      {inBookmarkGrid && <BulkBookmarksAction />}
      {inBookmarkGrid && <SortOrderToggle />}
    </div>
  );
}
