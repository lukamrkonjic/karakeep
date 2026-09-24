"use client";

import Link from "next/link";
import { isEmojiIcon } from "@/lib/emoji";
import { useListDrop } from "@/lib/hooks/useListDrop";
import { cn } from "@/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: one sub-list tile, which bookmarks can be dropped on like a sidebar
 * list — moved in from the list whose page this is (or, with Ctrl/Alt,
 * added) — see useListDrop.
 */
function SubfolderTile({
  list,
  items,
  subfolderCount,
}: {
  list: ZBookmarkList;
  items: number;
  subfolderCount: number;
}) {
  const canDrop =
    list.type === "manual" &&
    (list.userRole === "owner" || list.userRole === "editor");
  const drop = useListDrop(list, { enabled: canDrop });
  return (
    <Link
      href={`/dashboard/lists/${list.id}`}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
      className={cn(
        "group relative flex w-36 flex-col items-center gap-2 rounded-xl bg-muted p-3 text-center transition-[background-color,transform,box-shadow] duration-150 hover:bg-accent",
        drop.over && "scale-[1.04] bg-accent ring-2 ring-primary",
      )}
    >
      <div className="flex size-16 items-center justify-center rounded-lg bg-background/60 transition-colors group-hover:bg-background">
        {isEmojiIcon(list.icon) ? (
          <span className="text-3xl">{list.icon}</span>
        ) : (
          <Folder className="size-8 text-muted-foreground" strokeWidth={1.5} />
        )}
      </div>
      <div className="w-full min-w-0">
        <p className="truncate text-sm font-medium">{list.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {items} items
          {subfolderCount > 0 &&
            ` · ${subfolderCount} subfolder${subfolderCount === 1 ? "" : "s"}`}
        </p>
      </div>
      {drop.over && (
        <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground shadow-sm">
          {drop.over === "add" ? "+ Add" : "Move"}
        </span>
      )}
    </Link>
  );
}

/**
 * Eagle-style row of subfolder tiles shown at the top of a parent list's
 * page, above its bookmarks — a big icon tile per child list, with its item
 * count and (if it has any of its own) subfolder count below the name, so
 * you can jump straight into a nested list without digging through the
 * sidebar tree. Renders nothing for lists with no children.
 */
export default function ListSubfolders({ listId }: { listId: string }) {
  const api = useTRPC();
  const { data: lists } = useBookmarkLists();
  const { data: statsData } = useQuery(
    api.lists.stats.queryOptions(undefined, {
      placeholderData: keepPreviousData,
    }),
  );

  const allLists = lists?.data ?? [];
  const children = allLists
    .filter((l) => l.parentId === listId)
    .sort((a, b) => b.position - a.position);

  if (children.length === 0) {
    return null;
  }

  const subfolderCountOf = (id: string) =>
    allLists.filter((l) => l.parentId === id).length;

  return (
    <div className="flex flex-wrap gap-3">
      {children.map((child) => (
        <SubfolderTile
          key={child.id}
          list={child}
          items={statsData?.stats.get(child.id) ?? 0}
          subfolderCount={subfolderCountOf(child.id)}
        />
      ))}
    </div>
  );
}
