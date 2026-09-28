"use client";

import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  describeSmartGroup,
  describeSmartRule,
} from "@karakeep/shared/smartListRules";

import { SmartListDialog } from "./SmartListDialog";

/** A smart list's rules in words, one a line. */
function RulesInWords({ listId }: { listId: string }) {
  const api = useTRPC();
  const { data } = useQuery(api.smartLists.rules.queryOptions({ listId }));
  const { data: lists } = useBookmarkLists();
  if (!data) {
    return <span className="text-muted-foreground">…</span>;
  }
  const listName = (id: string) => lists?.data.find((l) => l.id === id)?.name;
  const { groups } = data.rules;
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group, g) => (
        <div key={g}>
          {/* The header only where it says something. */}
          {(groups.length > 1 || group.rules.length > 1 || group.negate) && (
            <p className="text-xs text-muted-foreground">
              {describeSmartGroup(group)}
            </p>
          )}
          <ul>
            {group.rules.map((rule, r) => (
              <li key={r}>{describeSmartRule(rule, { listName })}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Fork: "✨ Smart list" under a smart list's name — its rules in words on
 * hover, and for its owner a click opens them to change.
 */
export function SmartListNote({ list }: { list: ZBookmarkList }) {
  const [editing, setEditing] = useState(false);
  const isOwner = list.userRole === "owner";
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={isOwner ? () => setEditing(true) : undefined}
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Sparkles className="size-3.5" />
            Smart list
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs py-2">
          <RulesInWords listId={list.id} />
          {isOwner && (
            <p className="mt-2 text-xs text-muted-foreground">
              Click to change the rules
            </p>
          )}
        </TooltipContent>
      </Tooltip>
      {isOwner && (
        <SmartListDialog open={editing} setOpen={setEditing} list={list} />
      )}
    </>
  );
}
