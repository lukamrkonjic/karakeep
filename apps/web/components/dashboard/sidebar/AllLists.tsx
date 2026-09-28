"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import SidebarItem from "@/components/shared/sidebar/SidebarItem";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTriggerChevron,
} from "@/components/ui/collapsible";
import { isEmojiIcon } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n/client";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { useListDrop } from "@/lib/hooks/useListDrop";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Plus,
} from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  augmentBookmarkListsWithInitialData,
  useBookmarkLists,
} from "@karakeep/shared-react/hooks/lists";
import {
  listsToTree,
  ZBookmarkListTreeNode,
} from "@karakeep/shared/utils/listUtils";

import { TailoredFeedOptions } from "../feed/TailoredFeedOptions";
import type { OpenState } from "../lists/CollapsibleBookmarkLists";
import { CollapsibleBookmarkLists } from "../lists/CollapsibleBookmarkLists";
import { EditListModal } from "../lists/EditListModal";
import { ListOptions } from "../lists/ListOptions";
import { SmartListDialog } from "../lists/smart/SmartListDialog";
import { BookmarkPageOptions } from "../PageOptions";
import { InvitationNotificationBadge } from "./InvitationNotificationBadge";

function DroppableListSidebarItem({
  node,
  level,
  open,
  onOpenChange,
  numBookmarks,
  selectedListId,
  setSelectedListId,
}: {
  node: ZBookmarkListTreeNode;
  level: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  numBookmarks?: number;
  selectedListId: string | null;
  setSelectedListId: (id: string | null) => void;
}) {
  const canDrop =
    node.item.type === "manual" &&
    (node.item.userRole === "owner" || node.item.userRole === "editor");
  // Fork: bookmarks dropped here move (or, with Ctrl/Alt, are added); a
  // folded list unfolds when a drag rests on it, so its sub-lists can be
  // dropped on too (useListDrop).
  const drop = useListDrop(
    { id: node.item.id, name: node.item.name },
    {
      enabled: canDrop,
      onHover:
        node.children.length > 0 && !open
          ? () => onOpenChange(true)
          : undefined,
    },
  );

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
      dropHighlight={drop.over !== null}
      dropHint={drop.hint}
      onDragOver={drop.onDragOver}
      onDragEnter={drop.onDragEnter}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    />
  );
}

export default function AllLists({
  initialData,
  pages = true,
}: {
  initialData: { lists: ZBookmarkList[] };
  /** Fork: the pages above the lists (Home, Tailored feed, …); the phone's
   *  Lists sheet leaves them to the tab bar. */
  pages?: boolean;
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

  // Fork: your smart lists in a section of their own (above the lists), your
  // other lists below. Each is its own tree: a list whose parent is in the
  // other section shows at the top of its own.
  const [smartTree, manualTree] = useMemo(() => {
    const treeOf = (type: ZBookmarkList["type"]) => {
      const own = lists.data.filter(
        (l) => l.userRole === "owner" && l.type === type,
      );
      const ids = new Set(own.map((l) => l.id));
      const data = own.map((l) =>
        l.parentId && !ids.has(l.parentId) ? { ...l, parentId: null } : l,
      );
      return { data, ...listsToTree(data) };
    };
    return [treeOf("smart"), treeOf("manual")];
  }, [lists.data]);
  const smartFolded = !!usePreference("smartListsFolded");

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

  // Fork: only the lists scroll; the pages stay put. The lists' scrollbar is
  // always there (invisible until hovered), so rows don't narrow when
  // unfolding makes them overflow, and the pages reserve the same gutter so
  // everything lines up.
  const fixedPart =
    "sidebar-scrollbar shrink-0 overflow-hidden [scrollbar-gutter:stable]";
  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      <ul className={cn(fixedPart, !pages && "hidden")}>
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
                path="/dashboard/bookmarks"
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
        {/* Fork: pictures of yours you haven't seen in a while. */}
        <SidebarItem
          logo={null}
          name="Discover"
          path="/dashboard/discover"
          className="group my-0.5"
          linkClassName="py-1.5 px-2"
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
              path="/dashboard/tags"
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
              path="/dashboard/favourites"
            />
          }
        />
      </ul>

      {/* Fork: the pages above; your smart lists, then your lists, below —
          scrolling together, each section's heading staying in view while
          its rows scroll (and pushed up by the next section's). */}
      <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-scroll">
        <section aria-label="Smart lists">
          {pages && <div aria-hidden className="h-4" />}
          <div className="sticky top-0 z-10 flex items-center justify-between bg-background py-2">
            <button
              type="button"
              onClick={() =>
                void updatePreferences({ smartListsFolded: !smartFolded })
              }
              aria-expanded={!smartFolded}
              title={smartFolded ? "Show smart lists" : "Hide smart lists"}
              className="group/heading flex items-center gap-1 rounded-md pl-2 pr-1 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              Smart lists
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  !smartFolded && "rotate-90",
                  // Folded, it shows (something's hidden); else on hover.
                  smartFolded
                    ? "opacity-100"
                    : "opacity-0 group-hover/heading:opacity-100",
                )}
              />
            </button>
            <div className="mr-1 flex items-center gap-0.5 text-muted-foreground">
              <SmartListDialog>
                <button
                  type="button"
                  title="New smart list"
                  aria-label="New smart list"
                  className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="size-4" strokeWidth={1.5} />
                </button>
              </SmartListDialog>
            </div>
          </div>
          {!smartFolded && (
            <ul>
              {smartTree.data.length > 0 ? (
                <CollapsibleBookmarkLists
                  listsData={smartTree}
                  allLists={lists.data}
                  openState={openState}
                  reorderable
                  render={({
                    node,
                    level,
                    open,
                    onOpenChange,
                    numBookmarks,
                  }) => (
                    <DroppableListSidebarItem
                      node={node}
                      level={level}
                      open={open}
                      onOpenChange={onOpenChange}
                      numBookmarks={numBookmarks}
                      selectedListId={selectedListId}
                      setSelectedListId={setSelectedListId}
                    />
                  )}
                />
              ) : (
                <li className="px-2 py-1.5">
                  <SmartListDialog>
                    <button
                      type="button"
                      className="text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Lists that fill themselves — by colour, what&apos;s in the
                      picture, tags…
                    </button>
                  </SmartListDialog>
                </li>
              )}
            </ul>
          )}
        </section>

        <section aria-label="Lists">
          <div aria-hidden className="h-4" />
          <div className="sticky top-0 z-10 flex items-center justify-between bg-background py-2">
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

          <ul>
            {/* Owned Lists */}
            <CollapsibleBookmarkLists
              listsData={manualTree}
              allLists={lists.data}
              openState={openState}
              reorderable
              render={({ node, level, open, onOpenChange, numBookmarks }) => (
                <DroppableListSidebarItem
                  node={node}
                  level={level}
                  open={open}
                  onOpenChange={onOpenChange}
                  numBookmarks={numBookmarks}
                  selectedListId={selectedListId}
                  setSelectedListId={setSelectedListId}
                />
              )}
            />

            {/* Shared Lists */}
            {hasSharedLists && (
              <Collapsible
                open={sharedListsOpen}
                onOpenChange={setSharedListsOpen}
              >
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
                    render={({
                      node,
                      level,
                      open,
                      onOpenChange,
                      numBookmarks,
                    }) => (
                      <DroppableListSidebarItem
                        node={node}
                        level={level}
                        open={open}
                        onOpenChange={onOpenChange}
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
        </section>
      </div>
    </div>
  );
}
