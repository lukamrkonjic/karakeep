"use client";

import { useMemo, useState } from "react";
import { useColourLeftOut, useSetColourLeftOut } from "@/lib/leftOutLists";
import { cn } from "@/lib/utils";
import { ListX, X } from "lucide-react";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { colourLeftOutFor } from "@karakeep/shared/colourLeftOut";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";

import { OrganiseListsDialog } from "./OrganiseListsDialog";

/**
 * Fork: the lists left out of colours, over a grid they're left out of — a
 * colour page's, or a smart list's that asks for a colour (only those it
 * leaves out) — so it never passes for all of it. A tap opens List
 * settings → Colours; on a colour page, × brings them all back.
 */
export function ColourLeftOutChip({
  listId,
  onOpen,
}: {
  /** A list's page: shown only when it's a smart list asking for a colour. */
  listId?: string;
  /** Opens List settings → Colours; without it, the chip has its own. */
  onOpen?: () => void;
}) {
  const leftOut = useColourLeftOut();
  const setLeftOut = useSetColourLeftOut();
  const { data: lists } = useBookmarkLists();
  const [open, setOpen] = useState(false);

  const shown = useMemo(() => {
    if (!listId) {
      return leftOut;
    }
    const list = lists?.data.find((l) => l.id === listId);
    if (list?.type !== "smart" || !list.query) {
      return [];
    }
    const { matcher } = parseSearchQuery(list.query);
    return matcher ? colourLeftOutFor(matcher, leftOut) : [];
  }, [listId, lists?.data, leftOut]);
  if (shown.length === 0) {
    return null;
  }

  const names = shown.flatMap((id) => {
    const name = lists?.data.find((l) => l.id === id)?.name;
    return name ? [name] : [];
  });
  const label =
    names.length > 0 && names.length === shown.length && names.length <= 2
      ? names.join(", ")
      : `${shown.length} ${shown.length === 1 ? "list" : "lists"}`;
  return (
    <>
      {!onOpen && (
        <OrganiseListsDialog type="colours" open={open} setOpen={setOpen} />
      )}
      <span
        className={cn(
          "flex h-7 w-fit max-w-full items-center gap-1.5 rounded-full border bg-muted/50 pl-2.5 text-sm",
          listId ? "pr-2.5" : "pr-1",
        )}
      >
        <button
          type="button"
          onClick={onOpen ?? (() => setOpen(true))}
          title="Left out of colours — change it in List settings"
          className="flex min-w-0 items-center gap-1.5"
        >
          <ListX className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">Without {label}</span>
        </button>
        {!listId && (
          <button
            type="button"
            title="Show every list's pictures"
            aria-label="Show every list's pictures"
            onClick={() => void setLeftOut([])}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </span>
    </>
  );
}
