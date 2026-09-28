"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Search } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { smartListIds, smartListValue } from "@karakeep/shared/smartListRules";
import { listsToTree } from "@karakeep/shared/utils/listUtils";

import type { OpenState } from "../CollapsibleBookmarkLists";
import type { Tick } from "../ListTickRow";
import { CollapsibleBookmarkLists } from "../CollapsibleBookmarkLists";
import { ListTickRow } from "../ListTickRow";

/**
 * Fork: a smart list's Lists rule's lists — as many as you like in the one
 * rule ("contains" any of them, "doesn't contain" any of them), ticked in
 * the sidebar's tree the way the tailored feed picks its lists. A ticked
 * list brings everything under it (the rule counts a list as its sidebar row
 * does), so what's under it shows ticked too, and a list with a ticked list
 * somewhere under it half-ticked. Typing finds lists by name.
 */

/** Popovers inside a dialog: the dialog's scroll lock eats their wheel. */
const keepWheel = (e: React.WheelEvent) => e.stopPropagation();

type Lists = NonNullable<ReturnType<typeof useBookmarkLists>["data"]>;

interface Picking {
  lists: Lists;
  /** The lists that can be picked. */
  candidates: ZBookmarkList[];
  /** The lists above it, nearest first. */
  above: (id: string) => string[];
  ids: string[];
  onChange: (value: string) => void;
}

/** The sidebar's sections: your lists, your smart lists, lists shared. */
function sectionsOf(candidates: ZBookmarkList[]) {
  const section = (label: string, keep: (l: ZBookmarkList) => boolean) => {
    const own = candidates.filter(keep);
    const ids = new Set(own.map((l) => l.id));
    // Each section is its own tree: a list whose parent is in another one
    // shows at the top of its own.
    const data = own.map((l) =>
      l.parentId && !ids.has(l.parentId) ? { ...l, parentId: null } : l,
    );
    return { label, tree: { data, ...listsToTree(data) } };
  };
  return [
    section("Lists", (l) => l.userRole === "owner" && l.type === "manual"),
    section("Smart lists", (l) => l.userRole === "owner" && l.type === "smart"),
    section("Shared with you", (l) => l.userRole !== "owner"),
  ].filter((s) => s.tree.data.length > 0);
}

function PickerContent({ lists, candidates, above, ids, onChange }: Picking) {
  const [search, setSearch] = useState("");
  // The tree's counts (CollapsibleBookmarkLists reads the same), for a
  // search's results.
  const api = useTRPC();
  const { data: stats } = useQuery(
    api.lists.stats.queryOptions(undefined, {
      placeholderData: keepPreviousData,
    }),
  );
  // Opens unfolded down to every ticked list.
  const [unfolded, setUnfolded] = useState(() => new Set(ids.flatMap(above)));
  const openState: OpenState = {
    isOpen: (id) => unfolded.has(id),
    setOpen: (id, open) =>
      setUnfolded((prev) => {
        const next = new Set(prev);
        if (open) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      }),
  };
  const sections = useMemo(() => sectionsOf(candidates), [candidates]);

  const ticked = new Set(ids);
  const inherited = (id: string) => above(id).some((a) => ticked.has(a));
  const holdsTicked = new Set(ids.flatMap(above));
  const tickOf = (id: string): Tick =>
    ticked.has(id) || inherited(id)
      ? "on"
      : holdsTicked.has(id)
        ? "mixed"
        : "off";
  /** Ticking a list takes the ticked lists under it into it. */
  const toggle = (id: string) =>
    onChange(
      smartListValue(
        ticked.has(id)
          ? ids.filter((x) => x !== id)
          : [...ids.filter((x) => !above(x).includes(id)), id],
      ),
    );
  const row = (
    list: ZBookmarkList,
    props: {
      level?: number;
      folder?: boolean;
      open?: boolean;
      numBookmarks?: number;
      within?: string;
    },
  ) => (
    <ListTickRow
      key={list.id}
      list={list}
      tick={tickOf(list.id)}
      inherited={!ticked.has(list.id) && inherited(list.id)}
      onToggle={() => toggle(list.id)}
      {...props}
    />
  );

  const covered = candidates.filter(
    (l) => ticked.has(l.id) || inherited(l.id),
  ).length;
  const words = search.trim().toLowerCase();
  const pickable = new Set(candidates.map((l) => l.id));
  // Found by name, in the sidebar's order, each with the lists it's in.
  const found = words
    ? lists.allPaths.filter((path) => {
        const list = path[path.length - 1];
        return pickable.has(list.id) && list.name.toLowerCase().includes(words);
      })
    : null;

  return (
    <>
      <div className="flex items-center border-b px-3">
        <Search className="mr-2 size-4 shrink-0 opacity-50" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lists…"
          aria-label="Search lists"
          className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex items-center justify-between py-1 pl-3 pr-1 text-xs text-muted-foreground">
        <span>
          {covered} of {candidates.length} lists
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={ids.length === 0}
          onClick={() => onChange("")}
        >
          Clear
        </Button>
      </div>
      <div className="max-h-72 overflow-y-auto px-1 pb-1">
        {found ? (
          found.length > 0 ? (
            found.map((path) => {
              const list = path[path.length - 1];
              return row(list, {
                within:
                  path.length > 1
                    ? `${path
                        .slice(0, -1)
                        .map((p) => p.name)
                        .join(" / ")} /`
                    : undefined,
                numBookmarks: stats?.stats.get(list.id),
              });
            })
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No lists found.
            </p>
          )
        ) : (
          sections.map((s) => (
            <div key={s.label}>
              {sections.length > 1 && (
                <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  {s.label}
                </p>
              )}
              <CollapsibleBookmarkLists
                listsData={s.tree}
                openState={openState}
                render={({ node, level, open, numBookmarks }) =>
                  row(node.item, {
                    level,
                    folder: node.children.length > 0,
                    open,
                    numBookmarks,
                  })
                }
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function SmartListPicker({
  value,
  onChange,
  excludeListId,
  className,
}: {
  /** Lists' ids, comma-separated (smartListIds). */
  value: string;
  onChange: (value: string) => void;
  /** The smart list being edited: it and what's under it can't be picked. */
  excludeListId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: lists } = useBookmarkLists();
  const ids = smartListIds(value);

  /** The lists above a list, nearest first. */
  const above = useMemo(() => {
    const parentOf = new Map(
      (lists?.data ?? []).map((l) => [l.id, l.parentId ?? null]),
    );
    return (id: string) => {
      const out: string[] = [];
      let p = parentOf.get(id);
      while (p && !out.includes(p)) {
        out.push(p);
        p = parentOf.get(p);
      }
      return out;
    };
  }, [lists?.data]);
  const candidates = useMemo(
    () =>
      (lists?.data ?? []).filter(
        (l) =>
          l.userRole !== "viewer" &&
          (!excludeListId ||
            (l.id !== excludeListId && !above(l.id).includes(excludeListId))),
      ),
    [lists?.data, above, excludeListId],
  );

  const names = ids.flatMap((id) => {
    const list = lists?.data.find((l) => l.id === id);
    return list ? [list.name] : [];
  });
  const label =
    names.join(", ") || (ids.length > 0 ? "A list that's gone" : "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          title={names.length > 1 ? names.join(", ") : undefined}
          className={className}
        >
          <span className={cn("truncate", !label && "text-muted-foreground")}>
            {label || "Choose lists"}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-2">
            {ids.length > 1 && (
              <span className="rounded bg-background px-1.5 text-xs tabular-nums text-muted-foreground">
                {ids.length}
              </span>
            )}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] min-w-72 p-0"
        onWheel={keepWheel}
      >
        {lists && (
          <PickerContent
            lists={lists}
            candidates={candidates}
            above={above}
            ids={ids}
            onChange={onChange}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
