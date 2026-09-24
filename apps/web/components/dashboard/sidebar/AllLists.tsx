"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import SidebarItem from "@/components/shared/sidebar/SidebarItem";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTriggerChevron,
} from "@/components/ui/collapsible";
import { toast } from "@/components/ui/sonner";
import {
  BOOKMARK_DRAG_MIME,
  BOOKMARK_DRAG_SOURCE_LIST_MIME,
} from "@/lib/bookmark-drag";
import { isEmojiIcon } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n/client";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Plus,
} from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  augmentBookmarkListsWithInitialData,
  useAddBookmarkToList,
  useBookmarkLists,
  useRemoveBookmarkFromList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { ZBookmarkListTreeNode } from "@karakeep/shared/utils/listUtils";

import { TailoredFeedOptions } from "../feed/TailoredFeedOptions";
import type { OpenState } from "../lists/CollapsibleBookmarkLists";
import { CollapsibleBookmarkLists } from "../lists/CollapsibleBookmarkLists";
import { EditListModal } from "../lists/EditListModal";
import { ListOptions } from "../lists/ListOptions";
import { BookmarkPageOptions } from "../PageOptions";
import { InvitationNotificationBadge } from "./InvitationNotificationBadge";

function useDropTarget(listId: string, listName: string) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { data: allLists } = useBookmarkLists();
  const { mutateAsync: addToList } = useAddBookmarkToList();
  const { mutateAsync: removeFromList } = useRemoveBookmarkFromList();
  const [dropHighlight, setDropHighlight] = useState(false);
  const dragCounterRef = useRef(0);
  const { t } = useTranslation();

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME)) {
      e.preventDefault();
      // Every drop is a move (see onDrop).
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME)) {
      e.preventDefault();
      dragCounterRef.current++;
      setDropHighlight(true);
    }
  }, []);

  const onDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDropHighlight(false);
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      dragCounterRef.current = 0;
      setDropHighlight(false);
      const bookmarkId = e.dataTransfer.getData(BOOKMARK_DRAG_MIME);
      if (!bookmarkId) return;
      e.preventDefault();
      const sourceListId =
        e.dataTransfer.getData(BOOKMARK_DRAG_SOURCE_LIST_MIME) || undefined;
      if (sourceListId === listId) return; // dropped back onto its own list
      try {
        // A drop always MOVES, never copies: out of the list it was dragged
        // from, or, from a view that is not a list (home, search, a tag),
        // out of every list it is in. The preview's List chips are the one
        // place to put a bookmark in several lists at once.
        const { lists: current } = await queryClient.fetchQuery(
          api.lists.getListsOfBookmark.queryOptions({ bookmarkId }),
        );
        // Dragged out of a list, leave it — including from a sub-list of it,
        // since a parent's page can show everything nested under it.
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
        const leaving = current.filter(
          (l) =>
            l.id !== listId &&
            (sourceListId
              ? within(l.id, sourceListId)
              : l.type === "manual" && l.userRole !== "viewer"),
        );
        await addToList({ bookmarkId, listId });
        for (const from of leaving) {
          await removeFromList({ bookmarkId, listId: from.id });
        }
        toast({
          description: t("lists.move_to_list_success", {
            list: listName,
            defaultValue: `Moved to "${listName}"`,
          }),
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
      api,
      queryClient,
      allLists,
      addToList,
      removeFromList,
      listId,
      listName,
      t,
    ],
  );

  return { dropHighlight, onDragOver, onDragEnter, onDragLeave, onDrop };
}

function DroppableListSidebarItem({
  node,
  level,
  open,
  numBookmarks,
  selectedListId,
  setSelectedListId,
}: {
  node: ZBookmarkListTreeNode;
  level: number;
  open: boolean;
  numBookmarks?: number;
  selectedListId: string | null;
  setSelectedListId: (id: string | null) => void;
}) {
  const canDrop =
    node.item.type === "manual" &&
    (node.item.userRole === "owner" || node.item.userRole === "editor");
  const { dropHighlight, onDragOver, onDragEnter, onDragLeave, onDrop } =
    useDropTarget(node.item.id, node.item.name);

  return (
    <SidebarItem
      collapseButton={
        node.children.length > 0 ? (
          <CollapsibleTriggerChevron className="size-4" open={open} />
        ) : undefined
      }
      logo={
        isEmojiIcon(node.item.icon) ? (
          <span className="flex">
            <span className="text-lg">{node.item.icon}</span>
          </span>
        ) : null
      }
      name={node.item.name}
      path={`/dashboard/lists/${node.item.id}`}
      className="group my-0.5"
      right={
        <ListOptions
          onOpenChange={(isOpen) => {
            if (isOpen) {
              setSelectedListId(node.item.id);
            } else {
              setSelectedListId(null);
            }
          }}
          list={node.item}
        >
          <Button size="none" variant="ghost" className="relative">
            {/* Right-aligned (not centred over the count, whose width
                varies), so every row's "…" lines up — see PageOptions. */}
            <MoreHorizontal
              className={cn(
                "absolute inset-y-0 right-2.5 my-auto size-4 opacity-0 transition-opacity duration-100 group-hover:opacity-100",
                selectedListId == node.item.id ? "opacity-100" : "opacity-0",
              )}
            />
            <span
              className={cn(
                "px-2.5 text-xs font-light text-muted-foreground opacity-100 transition-opacity duration-100 group-hover:opacity-0",
                selectedListId == node.item.id || numBookmarks === undefined
                  ? "opacity-0"
                  : "opacity-100",
              )}
            >
              {numBookmarks}
            </span>
          </Button>
        </ListOptions>
      }
      linkClassName="py-1.5 px-2"
      style={{ marginLeft: `${level * 1}rem` }}
      dropHighlight={canDrop && dropHighlight}
      onDragOver={canDrop ? onDragOver : undefined}
      onDragEnter={canDrop ? onDragEnter : undefined}
      onDragLeave={canDrop ? onDragLeave : undefined}
      onDrop={canDrop ? onDrop : undefined}
    />
  );
}

export default function AllLists({
  initialData,
}: {
  initialData: { lists: ZBookmarkList[] };
}) {
  const { t } = useTranslation();
  const pathName = usePathname();

  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  // Fetch live lists data
  const { data: listsData } = useBookmarkLists(undefined, {
    initialData: { lists: initialData.lists },
  });
  const lists = augmentBookmarkListsWithInitialData(
    listsData,
    initialData.lists,
  );

  // Check if any shared list is currently being viewed
  const isViewingSharedList = useMemo(() => {
    return lists.data.some(
      (list) => list.userRole !== "owner" && pathName.includes(list.id),
    );
  }, [lists.data, pathName]);

  // Check if there are any shared lists
  const hasSharedLists = useMemo(() => {
    return lists.data.some((list) => list.userRole !== "owner");
  }, [lists.data]);

  const [sharedListsOpen, setSharedListsOpen] = useState(isViewingSharedList);

  // Auto-open shared lists if viewing one
  useEffect(() => {
    if (isViewingSharedList && !sharedListsOpen) {
      setSharedListsOpen(true);
    }
  }, [isViewingSharedList, sharedListsOpen]);

  // Fork: which lists are unfolded is kept in the account (every device
  // shows the tree as you left it), so "Collapse all"/"Expand all" can set
  // it in one go.
  const updatePreferences = useUpdatePreferences();
  const openIds = usePreference("sidebarOpenLists");
  const openSet = useMemo(() => new Set(openIds), [openIds]);
  const openState = useMemo<OpenState>(
    () => ({
      isOpen: (id) => openSet.has(id),
      setOpen: (id, open) =>
        void updatePreferences((prefs) => {
          const next = new Set(prefs.sidebarOpenLists);
          if (open) {
            next.add(id);
          } else {
            next.delete(id);
          }
          return { sidebarOpenLists: [...next] };
        }),
    }),
    [openSet, updatePreferences],
  );
  // Lists with something to unfold.
  const foldable = useMemo(
    () => [
      ...new Set(lists.data.flatMap((l) => (l.parentId ? [l.parentId] : []))),
    ],
    [lists.data],
  );
  const anyOpen =
    foldable.some((id) => openSet.has(id)) ||
    (hasSharedLists && sharedListsOpen);
  const foldAll = () => {
    void updatePreferences({ sidebarOpenLists: anyOpen ? [] : foldable });
    setSharedListsOpen(!anyOpen);
  };

  // Opening a list (from anywhere) unfolds the way to it, once per visit, so
  // it can still be folded away while it's open.
  const unfoldedFor = useRef<string | null>(null);
  useEffect(() => {
    const current = lists.data.find((l) => pathName.includes(l.id));
    if (!current || unfoldedFor.current === current.id) {
      return;
    }
    unfoldedFor.current = current.id;
    const parentOf = new Map(lists.data.map((l) => [l.id, l.parentId]));
    const path = [current.id];
    for (
      let at = current.parentId;
      at && path.length < 50;
      at = parentOf.get(at) ?? null
    ) {
      path.push(at);
    }
    if (path.some((id) => !openSet.has(id))) {
      void updatePreferences((prefs) => ({
        sidebarOpenLists: [
          ...new Set([...(prefs.sidebarOpenLists ?? []), ...path]),
        ],
      }));
    }
  }, [pathName, lists.data, openSet, updatePreferences]);

  // Fork: only the lists scroll; the pages and the heading stay put. The
  // lists' scrollbar is always there (invisible until hovered), so rows don't
  // narrow when unfolding makes them overflow, and the parts above reserve the
  // same gutter so everything lines up.
  const fixedPart =
    "sidebar-scrollbar shrink-0 overflow-hidden [scrollbar-gutter:stable]";
  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      <ul className={fixedPart}>
        {/* Fork: every entry has a "…" on hover, where a list's sits. Home
          took the All Lists page's place (list invitations show there). */}
        <SidebarItem
          logo={null}
          name={t("common.home")}
          path="/dashboard/bookmarks"
          className="group my-0.5"
          linkClassName="py-1.5 px-2"
          right={
            <div className="flex items-center">
              <InvitationNotificationBadge />
              <BookmarkPageOptions
                variant="sidebar"
                label="Home options"
                pageKey="home"
              />
            </div>
          }
        />
        <SidebarItem
          logo={null}
          name="Tailored feed"
          path="/dashboard/feed"
          className="group my-0.5"
          linkClassName="py-1.5 px-2"
          right={<TailoredFeedOptions variant="sidebar" />}
        />
        <SidebarItem
          logo={null}
          name={t("common.tags")}
          path="/dashboard/tags"
          className="group my-0.5"
          linkClassName="py-1.5 px-2"
          right={
            <BookmarkPageOptions
              variant="sidebar"
              label="Tags options"
              pageKey="tags"
            />
          }
        />
        <SidebarItem
          logo={null}
          name={t("lists.favourites")}
          path={`/dashboard/favourites`}
          className="group my-0.5"
          linkClassName="py-1.5 px-2"
          right={
            <BookmarkPageOptions
              variant="sidebar"
              label="Favourites options"
              pageKey="favourites"
            />
          }
        />
      </ul>

      {/* Fork: the pages above, the lists below their own heading. */}
      <div
        className={cn(fixedPart, "flex items-center justify-between pb-2 pt-6")}
      >
        <p className="pl-2 text-xs uppercase tracking-wider text-muted-foreground">
          Lists
        </p>
        <div className="mr-1 flex items-center gap-0.5 text-muted-foreground">
          {(foldable.length > 0 || hasSharedLists) && (
            <button
              type="button"
              onClick={foldAll}
              title={anyOpen ? "Collapse all" : "Expand all"}
              aria-label={anyOpen ? "Collapse all" : "Expand all"}
              className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            >
              {anyOpen ? (
                <ChevronsDownUp className="size-4" strokeWidth={1.5} />
              ) : (
                <ChevronsUpDown className="size-4" strokeWidth={1.5} />
              )}
            </button>
          )}
          <EditListModal>
            <button
              type="button"
              title="New list"
              aria-label="New list"
              className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-4" strokeWidth={1.5} />
            </button>
          </EditListModal>
        </div>
      </div>

      <ul className="sidebar-scrollbar min-h-0 flex-1 overflow-y-scroll">
        {/* Owned Lists */}
        <CollapsibleBookmarkLists
          listsData={lists}
          filter={(node) => node.item.userRole === "owner"}
          openState={openState}
          reorderable
          render={({ node, level, open, numBookmarks }) => (
            <DroppableListSidebarItem
              node={node}
              level={level}
              open={open}
              numBookmarks={numBookmarks}
              selectedListId={selectedListId}
              setSelectedListId={setSelectedListId}
            />
          )}
        />

        {/* Shared Lists */}
        {hasSharedLists && (
          <Collapsible open={sharedListsOpen} onOpenChange={setSharedListsOpen}>
            <SidebarItem
              collapseButton={
                <CollapsibleTriggerChevron
                  className="size-4"
                  open={sharedListsOpen}
                />
              }
              logo={<span className="text-lg">👥</span>}
              name={t("lists.shared_lists")}
              path="#"
              className="my-0.5"
              linkClassName="py-1.5 px-2"
            />
            <CollapsibleContent>
              <CollapsibleBookmarkLists
                listsData={lists}
                filter={(node) => node.item.userRole !== "owner"}
                openState={openState}
                indentOffset={1}
                render={({ node, level, open, numBookmarks }) => (
                  <DroppableListSidebarItem
                    node={node}
                    level={level}
                    open={open}
                    numBookmarks={numBookmarks}
                    selectedListId={selectedListId}
                    setSelectedListId={setSelectedListId}
                  />
                )}
              />
            </CollapsibleContent>
          </Collapsible>
        )}
      </ul>
    </div>
  );
}
