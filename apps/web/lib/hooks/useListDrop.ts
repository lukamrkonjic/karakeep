import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import {
  BOOKMARK_DRAG_SOURCE_LIST_MIME,
  draggedBookmarkCount,
  draggedBookmarkIds,
  isAddDrag,
  isBookmarkDrag,
} from "@/lib/bookmark-drag";
import useBulkActionsStore from "@/lib/bulkActions";
import { useTranslation } from "@/lib/i18n/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast as sonner } from "sonner";

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
 * other lists. `over` says what a drop would do right now and `hint` says
 * it for the target to show ("Move 3", "+ Add"); `onHover` fires once a drag
 * has rested on the target a moment (the sidebar unfolds a folded list that
 * way). After a drop, the message about it has an Undo; a selection that was
 * moved is let go (added, it stays picked for the next list).
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
  const [count, setCount] = useState(1);
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
      setCount(draggedBookmarkCount());
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
      // What changed, bookmark by bookmark, so it can be undone.
      const changes: {
        bookmarkId: string;
        joined: boolean;
        left: string[];
      }[] = [];
      try {
        await Promise.all(
          ids.map(async (bookmarkId) => {
            const { lists: before } = await queryClient.fetchQuery(
              api.lists.getListsOfBookmark.queryOptions({ bookmarkId }),
            );
            const joined = !before.some((l) => l.id === list.id);
            if (joined) {
              await addToList({ bookmarkId, listId: list.id });
            }
            const change = { bookmarkId, joined, left: [] as string[] };
            changes.push(change);
            if (add) {
              return;
            }
            const leaving = before.filter(
              (l) =>
                l.id !== list.id &&
                (sourceListId
                  ? within(l.id, sourceListId)
                  : l.type === "manual" && l.userRole !== "viewer"),
            );
            for (const from of leaving) {
              await removeFromList({ bookmarkId, listId: from.id });
              change.left.push(from.id);
            }
          }),
        );
        // A selection that was moved is let go; added, it stays picked (to
        // go into another list too).
        const selection = useBulkActionsStore.getState();
        if (
          !add &&
          selection.isBulkEditEnabled &&
          ids.every((id) => selection.selectedBookmarkIds.includes(id))
        ) {
          selection.setIsBulkEditEnabled(false);
        }
        const what = ids.length === 1 ? "" : `${ids.length} `;
        const undo = async () => {
          try {
            await Promise.all(
              changes.map(async ({ bookmarkId, joined, left }) => {
                for (const listId of left) {
                  await addToList({ bookmarkId, listId });
                }
                if (joined) {
                  await removeFromList({ bookmarkId, listId: list.id });
                }
              }),
            );
            sonner("Undone");
          } catch {
            sonner.error(
              t("common.something_went_wrong", {
                defaultValue: "Something went wrong",
              }),
            );
          }
        };
        sonner(
          add
            ? `Added ${what}to "${list.name}"`
            : ids.length === 1
              ? t("lists.move_to_list_success", {
                  list: list.name,
                  defaultValue: `Moved to "${list.name}"`,
                })
              : `Moved ${what}to "${list.name}"`,
          { action: { label: "Undo", onClick: () => void undo() } },
        );
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

  const hint = `${over === "add" ? "+ Add" : "Move"}${count > 1 ? ` ${count}` : ""}`;
  return { over, hint, onDragEnter, onDragOver, onDragLeave, onDrop };
}
