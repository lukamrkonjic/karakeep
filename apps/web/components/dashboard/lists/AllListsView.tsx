"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CollapsibleTriggerChevron } from "@/components/ui/collapsible";
import { isEmojiIcon } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n/client";
import { MoreHorizontal } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  augmentBookmarkListsWithInitialData,
  useBookmarkLists,
} from "@karakeep/shared-react/hooks/lists";

import { CollapsibleBookmarkLists } from "./CollapsibleBookmarkLists";
import { ListOptions } from "./ListOptions";
import {
  ListCollaboratorsIcons,
  ListItemCount,
  ListPrivacyLabel,
} from "./ListHeaderComponents";

function ListItem({
  name,
  icon,
  path,
  style,
  list,
  open,
  collapsible,
  itemCount,
  description,
}: {
  name: string;
  icon: string;
  path: string;
  level?: number;
  list?: ZBookmarkList;
  open?: boolean;
  collapsible: boolean;
  itemCount?: number;
  pinned?: boolean;
  description?: string;
  style?: React.CSSProperties;
}) {
  const formattedItemCount =
    itemCount !== undefined ? itemCount.toLocaleString() : undefined;

  return (
    <li
      className="group/list-row flex min-h-20 items-center justify-between gap-x-3 gap-y-2 px-4 py-4 transition-colors hover:bg-accent/30"
      style={style}
    >
      <div className="flex items-center gap-2">
        {/* Only rows with subfolders get a real chevron slot. Leaf/pinned
            rows (no chevron) skip the reserved space entirely so their
            icon/title sits as close to the left edge as the right-side
            items sit to the right edge. */}
        {collapsible && (
          <div className="flex h-full items-center justify-end">
            <CollapsibleTriggerChevron
              className="size-4 shrink-0 rounded-sm text-muted-foreground transition-transform hover:text-foreground"
              open={open ?? false}
            />
          </div>
        )}
        <Link href={path} className="flex min-w-0 items-center gap-2">
          {isEmojiIcon(icon) && <span className="text-xl">{icon}</span>}
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-lg text-foreground">{name}</p>
            </div>
            {(description || list?.description) && (
              <p className="truncate text-sm text-muted-foreground">
                {description || list?.description}
              </p>
            )}
          </div>
        </Link>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        {list && (
          <>
            <div className="hidden items-center gap-2 sm:flex">
              <ListCollaboratorsIcons className="mr-4" list={list} />
              <ListPrivacyLabel className="truncate" list={list} />
              <span aria-hidden>·</span>
              <ListItemCount className="text-muted-foreground" list={list} />
            </div>
            <ListOptions list={list}>
              <Button
                className="flex items-center justify-center"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </ListOptions>
          </>
        )}
        {!list && formattedItemCount !== undefined && (
          <span className="hidden items-center gap-2 sm:flex">
            {formattedItemCount} items
          </span>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="px-1 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl bg-muted/40">{children}</div>
    </section>
  );
}

export default function AllListsView({
  initialData,
  favoritesCount,
  archivedCount,
}: {
  initialData: ZBookmarkList[];
  favoritesCount?: number;
  archivedCount?: number;
}) {
  const { t } = useTranslation();

  // Fetch live lists data
  const { data: listsData } = useBookmarkLists(undefined, {
    initialData: { lists: initialData },
  });
  const lists = augmentBookmarkListsWithInitialData(listsData, initialData);

  // Check if there are any shared lists
  const hasSharedLists = useMemo(() => {
    return lists.data.some((list) => list.userRole !== "owner");
  }, [lists.data]);

  const hasOwnedLists = useMemo(() => {
    return lists.data.some((list) => list.userRole === "owner");
  }, [lists.data]);

  return (
    <div className="space-y-8">
      <Section title="Pinned">
        <ul className="divide-y">
          <ListItem
            collapsible={false}
            name={t("lists.favourites")}
            icon="⭐️"
            description="Things I keep coming back to."
            itemCount={favoritesCount}
            path={`/dashboard/favourites`}
            pinned
          />
          <ListItem
            collapsible={false}
            name={t("common.archive")}
            icon="🗄️"
            description="Cold storage, out of the way."
            itemCount={archivedCount}
            path={`/dashboard/archive`}
            pinned
          />
        </ul>
      </Section>

      {hasOwnedLists && (
        <Section title="All">
          <CollapsibleBookmarkLists
            className="border-b last:border-b-0"
            listsData={lists}
            filter={(node) => node.item.userRole === "owner"}
            render={({ node, level, open, numBookmarks }) => (
              <ListItem
                name={node.item.name}
                icon={node.item.icon}
                itemCount={numBookmarks}
                level={level}
                list={node.item}
                path={`/dashboard/lists/${node.item.id}`}
                collapsible={node.children.length > 0}
                open={open}
                style={{ marginLeft: `${level * 1}rem` }}
              />
            )}
          />
        </Section>
      )}

      {hasSharedLists && (
        <Section title={t("lists.shared_lists")}>
          <CollapsibleBookmarkLists
            className="border-b last:border-b-0"
            listsData={lists}
            filter={(node) => node.item.userRole !== "owner"}
            render={({ node, level, open, numBookmarks }) => (
              <ListItem
                name={node.item.name}
                icon={node.item.icon}
                itemCount={numBookmarks}
                level={level}
                list={node.item}
                path={`/dashboard/lists/${node.item.id}`}
                collapsible={node.children.length > 0}
                open={open}
              />
            )}
          />
        </Section>
      )}
    </div>
  );
}
