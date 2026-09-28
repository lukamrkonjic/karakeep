import { CollapsibleTriggerChevron } from "@/components/ui/collapsible";
import { isEmojiIcon } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import { Square, SquareCheck, SquareMinus } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";

export type Tick = "on" | "off" | "mixed";

const TICK_ICON = { on: SquareCheck, off: Square, mixed: SquareMinus };

/**
 * Fork: a list's row with a box to tick — how the tailored feed
 * (TailoredFeedSettings) and a smart list's Lists rule (SmartListPicker)
 * pick lists, in the sidebar's tree (CollapsibleBookmarkLists' render).
 */
export function ListTickRow({
  list,
  level = 0,
  tick,
  onToggle,
  folder = false,
  open = false,
  numBookmarks,
  within,
  inherited = false,
}: {
  list: ZBookmarkList;
  level?: number;
  tick: Tick;
  onToggle: () => void;
  /** Lists under it: a chevron that folds them (in a Collapsible). */
  folder?: boolean;
  open?: boolean;
  numBookmarks?: number;
  /** The lists it's in, before its name ("Art / "): a search's results. */
  within?: string;
  /** Ticked with the list it's in: shown ticked, not to untick alone. */
  inherited?: boolean;
}) {
  const Icon = TICK_ICON[tick];
  return (
    <div
      className="flex items-center gap-2 rounded-md py-1 pr-2 hover:bg-muted"
      style={{ paddingLeft: `${level * 1.25}rem` }}
    >
      {folder ? (
        <CollapsibleTriggerChevron
          open={open}
          className="size-4 shrink-0 cursor-pointer text-muted-foreground"
        />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <button
        type="button"
        aria-pressed={tick === "on" ? true : tick === "mixed" ? "mixed" : false}
        disabled={inherited}
        title={inherited ? "Ticked with the list it's in" : undefined}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:cursor-default"
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            tick === "off" || inherited
              ? "text-muted-foreground"
              : "text-foreground",
          )}
        />
        {within && (
          <span className="min-w-0 shrink-[2] truncate text-muted-foreground">
            {within}
          </span>
        )}
        {isEmojiIcon(list.icon) && <span>{list.icon}</span>}
        <span
          className={cn("truncate", tick === "off" && "text-muted-foreground")}
        >
          {list.name}
        </span>
      </button>
      {numBookmarks !== undefined && (
        <span className="text-xs text-muted-foreground">{numBookmarks}</span>
      )}
    </div>
  );
}
