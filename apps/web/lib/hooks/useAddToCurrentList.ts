"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { toast } from "@/components/ui/sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkListContext } from "@karakeep/shared-react/hooks/bookmark-list-context";
import { useAddBookmarkToList } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: whether something new can go into this list — a manual list you own
 * or edit (a smart list fills itself).
 */
export function canAddToList(
  list: ZBookmarkList | undefined,
): list is ZBookmarkList {
  return (
    !!list &&
    list.type === "manual" &&
    (list.userRole === "owner" || list.userRole === "editor")
  );
}

/** "/dashboard/lists/<id>" (and anything under it) → <id>. */
function listIdOfPath(pathname: string | null): string | undefined {
  return /^\/dashboard\/lists\/([^/?#]+)/.exec(pathname ?? "")?.[1];
}

/**
 * Fork: the list this page is, on a list's page. Inside the page that's its
 * list context; the header's "+" sits outside it (in the layout), so there
 * it's the list in the address.
 */
export function usePageList(): ZBookmarkList | undefined {
  const fromContext = useBookmarkListContext();
  const api = useTRPC();
  const listId = listIdOfPath(usePathname());
  const { data } = useQuery(
    api.lists.get.queryOptions(
      { listId: listId ?? "" },
      { enabled: !fromContext && !!listId },
    ),
  );
  return fromContext ?? (listId ? data : undefined);
}

/**
 * Fork: puts a bookmark just made into the list the page is (the list
 * context, which NewBookmarkDialog sets for the header's "+" too), when you
 * can add to it — saved before or not: adding it from a list says it
 * belongs there. Never fails the save; says so if the list didn't take it.
 */
export function useAddToCurrentList() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const list = useBookmarkListContext();
  const { mutateAsync: addToList } = useAddBookmarkToList();
  return useCallback(
    async (bookmark: { id: string }) => {
      if (!canAddToList(list)) {
        return;
      }
      try {
        await addToList({ bookmarkId: bookmark.id, listId: list.id });
      } catch {
        toast({
          description: `Saved, but it couldn't be added to ${list.name}`,
          variant: "destructive",
        });
        return;
      }
      // The page may show the list with its sub-lists (listIds), which the
      // add's own refresh (by listId) doesn't reach.
      void queryClient.invalidateQueries(
        api.bookmarks.getBookmarks.pathFilter(),
      );
    },
    [api, queryClient, list, addToList],
  );
}
