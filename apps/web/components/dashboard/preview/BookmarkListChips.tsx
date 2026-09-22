"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { isEmojiIcon } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n/client";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import {
  useAddBookmarkToList,
  useBookmarkLists,
  useRemoveBookmarkFromList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { listNameFromPath } from "@karakeep/shared/utils/listUtils";

/**
 * The preview's "List" section: a chip for every list the bookmark is in,
 * each with an x on hover that takes it out of that list, and a + that puts
 * it in another. This is the one place a bookmark goes into several lists —
 * dropping it on a sidebar list moves it (see AllLists.tsx). In no list at
 * all it is simply unsorted.
 */
export function BookmarkListChips({
  bookmarkId,
  readOnly = false,
}: {
  bookmarkId: string;
  readOnly?: boolean;
}) {
  const api = useTRPC();
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const { data } = useQuery(
    api.lists.getListsOfBookmark.queryOptions({ bookmarkId }),
  );
  const { data: allLists } = useBookmarkLists();
  const onError = () =>
    toast({ variant: "destructive", title: t("common.something_went_wrong") });
  const { mutate: addToList } = useAddBookmarkToList({ onError });
  const { mutate: removeFromList } = useRemoveBookmarkFromList({ onError });

  const lists = data?.lists ?? [];
  const inIds = new Set(lists.map((l) => l.id));
  // Lists it could go into: manual ones you can edit, and not already in.
  const choices = (allLists?.allPaths ?? []).filter((path) => {
    const list = path[path.length - 1];
    return (
      list.type === "manual" &&
      list.userRole !== "viewer" &&
      !inIds.has(list.id)
    );
  });

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("common.list", { defaultValue: "List" })}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {lists.map((list) => {
          const path = allLists?.getPathById(list.id);
          const canRemove = !readOnly && list.userRole !== "viewer";
          return (
            <span
              key={list.id}
              className="group/chip flex max-w-full items-center rounded-full bg-muted text-xs text-foreground"
            >
              <Link
                href={`/dashboard/lists/${list.id}`}
                title={path ? listNameFromPath(path) : list.name}
                className="flex min-w-0 items-center gap-1 py-1 pl-2.5 pr-2.5 hover:text-muted-foreground group-hover/chip:pr-1"
              >
                {isEmojiIcon(list.icon) && <span>{list.icon}</span>}
                <span className="truncate">{list.name}</span>
              </Link>
              {canRemove && (
                <button
                  type="button"
                  onClick={() =>
                    removeFromList({ bookmarkId, listId: list.id })
                  }
                  aria-label={`Remove from ${list.name}`}
                  title={`Remove from ${list.name}`}
                  // Folded away until you hover the chip (or tab to it).
                  className="mr-1 hidden rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:flex group-hover/chip:flex"
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          );
        })}
        {lists.length === 0 && (
          <span className="pr-1 text-sm text-muted-foreground">
            {t("common.unsorted", { defaultValue: "Unsorted" })}
          </span>
        )}
        {!readOnly && (
          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Add to a list"
                title="Add to a list"
                className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 p-0"
              onWheel={(e) => e.stopPropagation()}
            >
              <Command>
                <CommandInput placeholder="Search lists..." />
                <CommandList>
                  <CommandEmpty>No lists found.</CommandEmpty>
                  <CommandGroup className="max-h-60 overflow-y-auto">
                    {choices.map((path) => {
                      const list = path[path.length - 1];
                      return (
                        <CommandItem
                          key={list.id}
                          value={list.id}
                          keywords={[list.name, listNameFromPath(path)]}
                          onSelect={() => {
                            addToList({ bookmarkId, listId: list.id });
                            setAdding(false);
                          }}
                          className="cursor-pointer"
                        >
                          {listNameFromPath(path)}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
