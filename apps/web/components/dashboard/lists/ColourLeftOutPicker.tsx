"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  leftOutTree,
  useColourLeftOut,
  useSetColourLeftOut,
} from "@/lib/leftOutLists";

import type { Tick } from "./ListTickRow";
import { feedCandidates } from "../feed/TailoredFeedSettings";
import { CollapsibleBookmarkLists } from "./CollapsibleBookmarkLists";
import { ListTickRow } from "./ListTickRow";

/**
 * Fork: List settings → Colours — the lists left out of colours, picked as
 * the tailored feed's are: every list as the sidebar's tree, ticked unless
 * it's left out. Unticking a folder leaves out everything in it; open it to
 * keep single sub-lists back (then the folder's own items show again — a
 * left-out list always takes what's under it). Saved as it's ticked.
 */
export function ColourLeftOutPicker({
  listsData,
}: {
  listsData: Parameters<typeof CollapsibleBookmarkLists>[0]["listsData"];
}) {
  const leftOut = useColourLeftOut();
  const setLeftOut = useSetColourLeftOut();
  const candidates = useMemo(
    () => feedCandidates(listsData?.data ?? []),
    [listsData?.data],
  );
  const ids = useMemo(() => candidates.map((l) => l.id), [candidates]);
  const tree = useMemo(() => leftOutTree(candidates), [candidates]);
  const out = useMemo(() => tree.expand(leftOut), [tree, leftOut]);

  const save = (next: Set<string>) =>
    void setLeftOut([...tree.compress(next), ...tree.unknown(leftOut)]);
  const tickOf = (id: string): Tick => {
    const under = tree.walk(id);
    const kept = under.filter((x) => !out.has(x)).length;
    return kept === under.length ? "on" : kept === 0 ? "off" : "mixed";
  };
  const toggle = (id: string) => {
    const next = new Set(out);
    const leave = tickOf(id) === "on";
    for (const x of tree.walk(id)) {
      if (leave) {
        next.add(x);
      } else {
        next.delete(x);
      }
    }
    // Kept back in a left-out folder: the folders it's in aren't left out
    // whole any more.
    if (!leave) {
      for (const x of ids) {
        if (tree.walk(x).includes(id)) {
          next.delete(x);
        }
      }
    }
    save(next);
  };
  const kept = ids.filter((id) => !out.has(id)).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {kept === ids.length
            ? `All ${ids.length} lists`
            : `${kept} of ${ids.length} lists`}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => save(new Set())}>
            Select all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => save(new Set(ids))}>
            Clear
          </Button>
        </div>
      </div>
      <CollapsibleBookmarkLists
        listsData={listsData}
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
  );
}
