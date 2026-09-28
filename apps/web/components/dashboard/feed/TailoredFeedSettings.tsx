"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useSetTailoredFeedExcluded,
  useTailoredFeedExcluded,
} from "@/lib/tailoredFeed";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import type { Tick } from "../lists/ListTickRow";
import { CollapsibleBookmarkLists } from "../lists/CollapsibleBookmarkLists";
import { ListTickRow } from "../lists/ListTickRow";

/** The lists a tailored feed can draw from: your own manual lists. */
export function feedCandidates(lists: ZBookmarkList[]): ZBookmarkList[] {
  return lists.filter((l) => l.type === "manual" && l.userRole === "owner");
}

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
  const excluded = useTailoredFeedExcluded();
  const setExcluded = useSetTailoredFeedExcluded();

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
            render={({ node, level, open: expanded, numBookmarks }) =>
              node.item.type === "manual" ? (
                <ListTickRow
                  list={node.item}
                  level={level}
                  tick={tickOf(node.item.id)}
                  onToggle={() => toggle(node.item.id)}
                  folder={node.children.length > 0}
                  open={expanded}
                  numBookmarks={numBookmarks}
                />
              ) : null
            }
          />
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
