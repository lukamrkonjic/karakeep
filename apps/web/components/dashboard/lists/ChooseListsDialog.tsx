"use client";

import { useMemo } from "react";
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
import { leftOutTree } from "@/lib/leftOutLists";
import { cn } from "@/lib/utils";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import type { Tick } from "./ListTickRow";
import { CollapsibleBookmarkLists } from "./CollapsibleBookmarkLists";
import { ListTickRow } from "./ListTickRow";

/** The lists one can pick from: your own manual lists. */
export function listCandidates(lists: ZBookmarkList[]): ZBookmarkList[] {
  return lists.filter((l) => l.type === "manual" && l.userRole === "owner");
}

/** How a picker's ticks read and change. */
export interface ListTicks {
  tickOf: (id: string) => Tick;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
  /** Lists ticked, of `total`. */
  kept: number;
  total: number;
}

/** A list and everything under it, among these lists. */
function subtreeOf(lists: ZBookmarkList[]) {
  const children = new Map<string, string[]>();
  for (const l of lists) {
    if (l.parentId) {
      children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
    }
  }
  const walk = (id: string): string[] => [
    id,
    ...(children.get(id) ?? []).flatMap(walk),
  ];
  return walk;
}

/**
 * Ticks kept as the lists left out, each on its own — the tailored feed's:
 * a list made later is ticked, in the feed, until it's unticked.
 */
export function useExcludedTicks(
  candidates: ZBookmarkList[],
  excluded: string[],
  setExcluded: (excluded: string[]) => void,
): ListTicks {
  const subtree = useMemo(() => subtreeOf(candidates), [candidates]);
  const out = new Set(excluded);
  const tickOf = (id: string): Tick => {
    const ids = subtree(id);
    const kept = ids.filter((x) => !out.has(x)).length;
    return kept === ids.length ? "on" : kept === 0 ? "off" : "mixed";
  };
  return {
    tickOf,
    toggle: (id) => {
      const ids = subtree(id);
      const next = new Set(out);
      if (tickOf(id) === "on") {
        ids.forEach((x) => next.add(x));
      } else {
        ids.forEach((x) => next.delete(x));
      }
      setExcluded([...next]);
    },
    selectAll: () => setExcluded([]),
    clear: () => setExcluded(candidates.map((l) => l.id)),
    kept: candidates.filter((l) => !out.has(l.id)).length,
    total: candidates.length,
  };
}

/**
 * Ticks kept as the fewest left-out lists, each standing for everything
 * under it (a smart list's, the colour pages'): a list made later in a
 * left-out folder is left out too. Unticking a folder leaves out all of it;
 * ticking one sub-list back keeps the rest of the folder out — and the
 * folder's own items in, as a left-out list always takes what's under it.
 */
export function useLeftOutTicks(
  candidates: ZBookmarkList[],
  leftOut: string[],
  setLeftOut: (leftOut: string[]) => void,
): ListTicks {
  const ids = useMemo(() => candidates.map((l) => l.id), [candidates]);
  const tree = useMemo(() => leftOutTree(candidates), [candidates]);
  const out = useMemo(() => tree.expand(leftOut), [tree, leftOut]);
  const save = (next: Set<string>) =>
    setLeftOut([...tree.compress(next), ...tree.unknown(leftOut)]);
  const tickOf = (id: string): Tick => {
    const under = tree.walk(id);
    const kept = under.filter((x) => !out.has(x)).length;
    return kept === under.length ? "on" : kept === 0 ? "off" : "mixed";
  };
  return {
    tickOf,
    toggle: (id) => {
      const next = new Set(out);
      const leave = tickOf(id) === "on";
      for (const x of tree.walk(id)) {
        if (leave) {
          next.add(x);
        } else {
          next.delete(x);
        }
      }
      // Kept back in a left-out folder: the folders it's in aren't left
      // out whole any more.
      if (!leave) {
        for (const x of ids) {
          if (tree.walk(x).includes(id)) {
            next.delete(x);
          }
        }
      }
      save(next);
    },
    selectAll: () => save(new Set()),
    clear: () => save(new Set(ids)),
    kept: ids.filter((id) => !out.has(id)).length,
    total: ids.length,
  };
}

/**
 * Fork: "…" → Choose lists… — the tailored feed's, a smart list's and the
 * colour pages': every list as the sidebar's tree, each with a tick, "N of
 * M lists", Select all and Clear. Ticking a folder takes in (or leaves out)
 * everything inside it; open it to leave single sub-lists out, and the
 * folder shows half-ticked. What a tick means is the caller's (`ticks`).
 * Opened by its trigger (`children`), or controlled with `open`/`setOpen`.
 */
export function ChooseListsDialog({
  title,
  description,
  ticks,
  loading = false,
  children,
  open,
  setOpen,
}: {
  title: string;
  description: string;
  ticks: ListTicks;
  /** What's ticked is still on its way: no ticks to change yet. */
  loading?: boolean;
  children?: React.ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { data: lists } = useBookmarkLists(undefined, { enabled: open });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {loading
              ? "Loading…"
              : ticks.kept === ticks.total
                ? `All ${ticks.total} lists`
                : `${ticks.kept} of ${ticks.total} lists`}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={ticks.selectAll}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={ticks.clear}
            >
              Clear
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "-mx-2 min-h-0 flex-1 overflow-y-auto px-2",
            loading && "pointer-events-none opacity-50",
          )}
        >
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
                  tick={ticks.tickOf(node.item.id)}
                  onToggle={() => ticks.toggle(node.item.id)}
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
