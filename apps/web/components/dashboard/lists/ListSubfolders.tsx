"use client";

import Link from "next/link";
import { isEmojiIcon } from "@/lib/emoji";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

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
      {children.map((child) => {
        const subfolderCount = subfolderCountOf(child.id);
        return (
          <Link
            key={child.id}
            href={`/dashboard/lists/${child.id}`}
            className="group flex w-36 flex-col items-center gap-2 rounded-xl bg-muted p-3 text-center transition-colors hover:bg-accent"
          >
            <div className="flex size-16 items-center justify-center rounded-lg bg-background/60 transition-colors group-hover:bg-background">
              {isEmojiIcon(child.icon) ? (
                <span className="text-3xl">{child.icon}</span>
              ) : (
                <Folder
                  className="size-8 text-muted-foreground"
                  strokeWidth={1.5}
                />
              )}
            </div>
            <div className="w-full min-w-0">
              <p className="truncate text-sm font-medium">{child.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {statsData?.stats.get(child.id) ?? 0} items
                {subfolderCount > 0 &&
                  ` · ${subfolderCount} subfolder${subfolderCount === 1 ? "" : "s"}`}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
