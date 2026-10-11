"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  compileSmartRules,
  smartRulesLeftOut,
  withSmartRulesLeftOut,
} from "@karakeep/shared/smartListRules";

import { LeaveListsOutDialog } from "../LeaveListsOutDialog";
import { RULES_FRESH, useRefreshSmartList } from "./SmartListDialog";

/**
 * Fork: a smart list's "…" → Leave lists out… — the lists it leaves out
 * are its own "Lists doesn't contain" rule (smartRulesLeftOut), so Edit
 * shows the same, and every app reads it from the list's query. Opens once
 * its rules are in (the menu reads them as it opens).
 */
export function SmartListLeaveOut({
  list,
  open,
  setOpen,
}: {
  list: ZBookmarkList;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const refresh = useRefreshSmartList();
  const { data, error } = useQuery(
    api.smartLists.rules.queryOptions(
      { listId: list.id },
      { ...RULES_FRESH, enabled: open },
    ),
  );
  useEffect(() => {
    if (open && error) {
      toast({
        variant: "destructive",
        description: `Couldn't read this smart list's rules: ${error.message}`,
      });
      setOpen(false);
    }
  }, [open, error, setOpen]);

  const update = useMutation(
    api.smartLists.update.mutationOptions({
      onSuccess: (_list, { rules }) => {
        // Opened again at once, it shows what was saved.
        if (rules) {
          queryClient.setQueryData(
            api.smartLists.rules.queryKey({ listId: list.id }),
            { rules },
          );
        }
        refresh(list.id);
      },
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );

  if (!data) {
    return null;
  }
  return (
    <LeaveListsOutDialog
      open={open}
      setOpen={setOpen}
      leftOut={smartRulesLeftOut(data.rules)}
      onSave={(leftOut) => {
        const rules = withSmartRulesLeftOut(data.rules, leftOut);
        if (!compileSmartRules(rules).query) {
          // Leaving lists out was all it did: it needs a rule to keep.
          toast({
            variant: "destructive",
            description: `“${list.name}” has no other rule, so it has to leave something out — change it with Edit.`,
          });
          return;
        }
        update.mutate({ listId: list.id, rules });
      }}
      description={
        <>
          What&apos;s in a list you untick stays out of “{list.name}”. Unticking
          a folder leaves out everything in it; open it to keep single
          sub-lists. It&apos;s one of the list&apos;s rules, so Edit shows it
          too.
        </>
      }
    />
  );
}
