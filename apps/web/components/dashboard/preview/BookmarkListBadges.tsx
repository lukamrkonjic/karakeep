"use client";

import Link from "next/link";
import { isEmojiIcon } from "@/lib/emoji";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Shows which list(s) a bookmark belongs to, next to its title in the
 * preview modal — makes it easy to identify/navigate back to the list
 * you found it in without leaving the preview.
 */
export function BookmarkListBadges({ bookmarkId }: { bookmarkId: string }) {
  const api = useTRPC();
  const { data } = useQuery(
    api.lists.getListsOfBookmark.queryOptions({ bookmarkId }),
  );
  const lists = data?.lists;

  if (!lists || lists.length === 0) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {lists.map((list) => (
        <Link
          key={list.id}
          href={`/dashboard/lists/${list.id}`}
          title={list.name}
          className="flex max-w-32 items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {isEmojiIcon(list.icon) && <span>{list.icon}</span>}
          <span className="truncate">{list.name}</span>
        </Link>
      ))}
    </div>
  );
}
