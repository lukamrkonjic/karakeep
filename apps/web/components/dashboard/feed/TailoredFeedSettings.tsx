"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleTriggerChevron } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { isEmojiIcon } from "@/lib/emoji";
import { useTailoredFeed } from "@/lib/tailoredFeed";
import { cn } from "@/lib/utils";
import { Square, SquareCheck, SquareMinus } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import { CollapsibleBookmarkLists } from "../lists/CollapsibleBookmarkLists";

/** The lists a tailored feed can draw from: your own manual lists. */
export function feedCandidates(lists: ZBookmarkList[]): ZBookmarkList[] {
  return lists.filter((l) => l.type === "manual" && l.userRole === "owner");
}

type Tick = "on" | "off" | "mixed";

const TICK_ICON = { on: SquareCheck, off: Square, mixed: SquareMinus };

/**
 * The tailored feed's settings: every list as the sidebar's tree, each with a
 * tick. Ticking a folder takes in (or leaves out) everything inside it; open
 * it to leave out single sub-lists, and the folder shows half-ticked.
 * Opened by its trigger (`children`), or controlled with `open`/`setOpen`
 * (the feed's "…" menu, TailoredFeedOptions).
 */
export function TailoredFeedSettings({
  children,
  open: controlledOpen,
  setOpen: setControlledOpen,
}: {
  children?: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = setControlledOpen ?? setOwnOpen;
  const { data: lists } = useBookmarkLists();
  const excluded = useTailoredFeed((s) => s.excluded);
  const setExcluded = useTailoredFeed((s) => s.setExcluded);

  const candidates = useMemo(
    () => feedCandidates(lists?.data ?? []),
    [lists?.data],
  );
  // A list and everything nested under it, candidates only.
  const subtree = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const l of candidates) {
      if (l.parentId) {
        children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
      }
    }
    const walk = (id: string): string[] => [
      id,
      ...(children.get(id) ?? []).flatMap(walk),
    ];
    return walk;
  }, [candidates]);

  const out = new Set(excluded);
  const tickOf = (id: string): Tick => {
    const ids = subtree(id);
    const kept = ids.filter((x) => !out.has(x)).length;
    return kept === ids.length ? "on" : kept === 0 ? "off" : "mixed";
  };
  const toggle = (id: string) => {
    const ids = subtree(id);
    const next = new Set(out);
    if (tickOf(id) === "on") {
      ids.forEach((x) => next.add(x));
    } else {
      ids.forEach((x) => next.delete(x));
    }
    setExcluded([...next]);
  };
  const kept = candidates.filter((l) => !out.has(l.id)).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Tailored feed</DialogTitle>
          <DialogDescription>
            Pick the lists your feed is made of. A folder brings everything in
            it; open it to leave single sub-lists out.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {kept} of {candidates.length} lists
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setExcluded([])}>
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExcluded(candidates.map((l) => l.id))}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          <CollapsibleBookmarkLists
            listsData={lists}
            filter={(node) =>
              node.item.type === "manual" && node.item.userRole === "owner"
            }
            render={({ node, level, open: expanded, numBookmarks }) => {
              if (node.item.type !== "manual") {
                return null;
              }
              const tick = tickOf(node.item.id);
              const Icon = TICK_ICON[tick];
              return (
                <div
                  className="flex items-center gap-2 rounded-md py-1 pr-2 hover:bg-muted"
                  style={{ paddingLeft: `${level * 1.25}rem` }}
                >
                  {node.children.length > 0 ? (
                    <CollapsibleTriggerChevron
                      open={expanded}
                      className="size-4 shrink-0 cursor-pointer text-muted-foreground"
                    />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                  <button
                    type="button"
                    aria-pressed={
                      tick === "on" ? true : tick === "mixed" ? "mixed" : false
                    }
                    onClick={() => toggle(node.item.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        tick === "off"
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    />
                    {isEmojiIcon(node.item.icon) && (
                      <span>{node.item.icon}</span>
                    )}
                    <span
                      className={cn(
                        "truncate",
                        tick === "off" && "text-muted-foreground",
                      )}
                    >
                      {node.item.name}
                    </span>
                  </button>
                  {numBookmarks !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {numBookmarks}
                    </span>
                  )}
                </div>
              );
            }}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
