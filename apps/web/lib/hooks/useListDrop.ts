import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import {
  BOOKMARK_DRAG_SOURCE_LIST_MIME,
  draggedBookmarkIds,
  isAddDrag,
  isBookmarkDrag,
} from "@/lib/bookmark-drag";
import { useTranslation } from "@/lib/i18n/client";
import { useQueryClient } from "@tanstack/react-query";

import {
  useAddBookmarkToList,
  useBookmarkLists,
  useRemoveBookmarkFromList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

/** How long a drag must rest on a target before `onHover` fires. */
const HOVER_MS = 650;

/**
 * Fork: a list as a place to drop bookmarks — the sidebar's rows and a list
 * page's sub-list tiles. A drop moves them there: out of the list they were
 * dragged from (and its sub-lists, which a parent's page can show), or, from
 * a page that isn't a list (home, search, a tag), out of every list they're
 * in. With Ctrl (or Alt/Option) held it adds instead, and they keep their
 * other lists. `over` says what a drop would do right now, for the target to
 * show; `onHover` fires once a drag has rested on the target a moment (the
 * sidebar unfolds a folded list that way).
 */
export function useListDrop(
  list: { id: string; name: string },
  { enabled = true, onHover }: { enabled?: boolean; onHover?: () => void } = {},
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { data: allLists } = useBookmarkLists();
  const { mutateAsync: addToList } = useAddBookmarkToList();
  const { mutateAsync: removeFromList } = useRemoveBookmarkFromList();
  const [over, setOver] = useState<"move" | "add" | null>(null);
  const depth = useRef(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopHover = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!isBookmarkDrag(e)) {
        return;
      }
      depth.current++;
      // Even where it can't be dropped: a folded list unfolds to what can.
      if (onHover && !hoverTimer.current) {
        hoverTimer.current = setTimeout(() => {
          hoverTimer.current = null;
          onHover();
        }, HOVER_MS);
      }
      if (!enabled) {
        return;
      }
      e.preventDefault();
      setOver(isAddDrag(e) ? "add" : "move");
    },
    [enabled, onHover],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !isBookmarkDrag(e)) {
        return;
      }
      e.preventDefault();
      const mode = isAddDrag(e) ? "add" : "move";
      e.dataTransfer.dropEffect = mode === "add" ? "copy" : "move";
      setOver(mode);
    },
    [enabled],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isBookmarkDrag(e)) {
      return;
    }
    depth.current--;
    if (depth.current <= 0) {
      depth.current = 0;
      setOver(null);
      stopHover();
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      depth.current = 0;
      setOver(null);
      stopHover();
      const ids = draggedBookmarkIds(e);
      if (!enabled || ids.length === 0) {
        return;
      }
      e.preventDefault();
      const add = isAddDrag(e);
      const sourceListId =
        e.dataTransfer.getData(BOOKMARK_DRAG_SOURCE_LIST_MIME) || undefined;
      if (!add && sourceListId === list.id) {
        return; // dropped back onto its own list
      }
      // A list and everything nested under it.
      const parentOf = new Map(
        (allLists?.data ?? []).map((l) => [l.id, l.parentId ?? null]),
      );
      const within = (id: string, rootId: string) => {
        for (
          let cur: string | null | undefined = id, hops = 0;
          cur && hops < 50;
          cur = parentOf.get(cur), hops++
        ) {
          if (cur === rootId) {
            return true;
          }
        }
        return false;
      };
      try {
        await Promise.all(
          ids.map(async (bookmarkId) => {
            await addToList({ bookmarkId, listId: list.id });
            if (add) {
              return;
            }
            const { lists: current } = await queryClient.fetchQuery(
              api.lists.getListsOfBookmark.queryOptions({ bookmarkId }),
            );
            const leaving = current.filter(
              (l) =>
                l.id !== list.id &&
                (sourceListId
                  ? within(l.id, sourceListId)
                  : l.type === "manual" && l.userRole !== "viewer"),
            );
            for (const from of leaving) {
              await removeFromList({ bookmarkId, listId: from.id });
            }
          }),
        );
        const what = ids.length === 1 ? "" : `${ids.length} `;
        toast({
          description: add
            ? `Added ${what}to "${list.name}"`
            : ids.length === 1
              ? t("lists.move_to_list_success", {
                  list: list.name,
                  defaultValue: `Moved to "${list.name}"`,
                })
              : `Moved ${what}to "${list.name}"`,
        });
      } catch {
        toast({
          description: t("common.something_went_wrong", {
            defaultValue: "Something went wrong",
          }),
          variant: "destructive",
        });
      }
    },
    [
      enabled,
      list.id,
      list.name,
      allLists,
      addToList,
      removeFromList,
      queryClient,
      api,
      t,
    ],
  );

  return { over, onDragEnter, onDragOver, onDragLeave, onDrop };
}
