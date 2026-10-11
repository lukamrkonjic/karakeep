"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { leftOutTree, sameLists } from "@/lib/leftOutLists";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import type { Tick } from "./ListTickRow";
import { feedCandidates } from "../feed/TailoredFeedSettings";
import { CollapsibleBookmarkLists } from "./CollapsibleBookmarkLists";
import { ListTickRow } from "./ListTickRow";

/**
 * Fork: "Leave lists out…" — the lists a colour page (lib/leftOutLists.ts)
 * or a smart list (smart/SmartListLeaveOut.tsx) doesn't show, picked as the
 * tailored feed's are: every list as the sidebar's tree, ticked unless it's
 * left out. Unticking a folder leaves out everything in it; open it to keep
 * single sub-lists. What's picked is handed over (`onSave`) as the dialog
 * closes, however it's closed, and only when it changed.
 */
export function LeaveListsOutDialog({
  open,
  setOpen,
  description,
  leftOut,
  onSave,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  description: React.ReactNode;
  /** The lists left out now, each with everything under it. */
  leftOut: string[];
  onSave: (leftOut: string[]) => void;
}) {
  const { data: lists } = useBookmarkLists();
  const candidates = useMemo(
    () => feedCandidates(lists?.data ?? []),
    [lists?.data],
  );
  const tree = useMemo(() => leftOutTree(candidates), [candidates]);
  // What the open picker has ticked off, for when it closes.
  const picked = useRef<Set<string> | null>(null);

  const close = () => {
    if (picked.current) {
      const next = [...tree.compress(picked.current), ...tree.unknown(leftOut)];
      if (!sameLists(next, leftOut)) {
        onSave(next);
      }
    }
    picked.current = null;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Leave lists out</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {lists && (
          <Picker
            // Mounted as it opens: it starts from what's kept each time.
            initial={tree.expand(leftOut)}
            candidates={candidates.map((l) => l.id)}
            walk={tree.walk}
            listsData={lists}
            onChange={(out) => (picked.current = out)}
          />
        )}
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  initial,
  candidates,
  walk,
  listsData,
  onChange,
}: {
  initial: Set<string>;
  candidates: string[];
  walk: (id: string) => string[];
  listsData: Parameters<typeof CollapsibleBookmarkLists>[0]["listsData"];
  onChange: (out: Set<string>) => void;
}) {
  const [out, setOutState] = useState(initial);
  const setOut = (next: Set<string>) => {
    setOutState(next);
    onChange(next);
  };

  const tickOf = (id: string): Tick => {
    const ids = walk(id);
    const kept = ids.filter((x) => !out.has(x)).length;
    return kept === ids.length ? "on" : kept === 0 ? "off" : "mixed";
  };
  const toggle = (id: string) => {
    const next = new Set(out);
    const leave = tickOf(id) === "on";
    for (const x of walk(id)) {
      if (leave) {
        next.add(x);
      } else {
        next.delete(x);
      }
    }
    // A sub-list kept back in a left-out folder: the folder's no longer
    // left out whole, so up the tree each folder is kept itself.
    if (!leave) {
      for (const x of candidates) {
        if (walk(x).includes(id)) {
          next.delete(x);
        }
      }
    }
    setOut(next);
  };
  const kept = candidates.filter((id) => !out.has(id)).length;

  return (
    <>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {kept === candidates.length
            ? `All ${candidates.length} lists`
            : `${kept} of ${candidates.length} lists`}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOut(new Set())}>
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOut(new Set(candidates))}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
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
    </>
  );
}
