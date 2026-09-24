"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isEmojiIcon } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { listNameFromPath } from "@karakeep/shared/utils/listUtils";

// Wait this long before asking: a pointer sweeping across the grid asks for
// nothing.
const HOVER_INTENT_MS = 150;
const MAX_CHIPS = 3;

const CHIP =
  "pointer-events-auto flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium leading-4 text-white backdrop-blur-sm";

/**
 * Fork: the lists a picture is in, as small chips along the bottom of its
 * masonry tile while the pointer rests on it — clear of the title and the
 * actions along the top and of the magnifier in the bottom-right corner
 * (`clearRight`). A chip opens its list; its tooltip is the list's path.
 * Mounted only while hovered (see MasonryMediaCard). A tile hovered before
 * shows its chips at once from the cache and refreshes them on every hover,
 * so a list renamed or deleted since is right a moment later.
 */
export function HoverListChips({
  bookmarkId,
  clearRight,
}: {
  bookmarkId: string;
  clearRight: boolean;
}) {
  const api = useTRPC();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), HOVER_INTENT_MS);
    return () => clearTimeout(timer);
  }, []);
  const { data } = useQuery({
    ...api.lists.getListsOfBookmark.queryOptions({ bookmarkId }),
    enabled: ready,
  });
  const { data: allLists } = useBookmarkLists();

  const lists = data?.lists ?? [];
  if (lists.length === 0) {
    return null;
  }
  const pathOf = (list: (typeof lists)[number]) => {
    const path = allLists?.getPathById(list.id);
    return path ? listNameFromPath(path) : list.name;
  };
  // Three at most; past that, two and a "+N" naming the rest.
  const shown =
    lists.length > MAX_CHIPS ? lists.slice(0, MAX_CHIPS - 1) : lists;
  const rest = lists.slice(shown.length);

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 z-20 flex flex-wrap-reverse items-center gap-1 duration-150 animate-in fade-in-0",
        clearRight ? "right-11" : "right-2",
      )}
    >
      {shown.map((list) => (
        <Link
          key={list.id}
          href={`/dashboard/lists/${list.id}`}
          draggable={false}
          title={pathOf(list)}
          className={cn(CHIP, "max-w-[10rem] hover:bg-black/70")}
        >
          {isEmojiIcon(list.icon) ? (
            <span className="shrink-0">{list.icon}</span>
          ) : (
            <Folder className="size-3 shrink-0" />
          )}
          <span className="truncate">{list.name}</span>
        </Link>
      ))}
      {rest.length > 0 && (
        <span title={rest.map(pathOf).join("\n")} className={CHIP}>
          +{rest.length}
        </span>
      )}
    </div>
  );
}
