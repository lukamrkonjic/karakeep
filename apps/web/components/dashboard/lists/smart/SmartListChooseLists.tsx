"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

import {
  ChooseListsDialog,
  listCandidates,
  useLeftOutTicks,
} from "../ChooseListsDialog";

const LEFT_OUT_FRESH = { staleTime: 30_000, gcTime: 60_000 };

/** Fetches a smart list's chosen lists ahead, as its "…" opens. */
export function PrefetchSmartListLeftOut({ listId }: { listId: string }) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.prefetchQuery(
      api.smartLists.leftOut.queryOptions({ listId }, LEFT_OUT_FRESH),
    );
  }, [api, queryClient, listId]);
  return null;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Fork: a smart list's "…" → Choose lists…, as the tailored feed picks its
 * lists (ChooseListsDialog): what's in an unticked list, or in a list under
 * one, isn't in the smart list, whatever its rules say (the server's
 * smartLists.leftOut). Ticked as a draft, saved once as it closes (Done,
 * ×, Esc) when something changed: the list and its count then reload.
 */
export function SmartListChooseLists({
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
  const { data: lists } = useBookmarkLists();
  const candidates = useMemo(
    () => listCandidates(lists?.data ?? []),
    [lists?.data],
  );
  const { data: saved } = useQuery(
    api.smartLists.leftOut.queryOptions(
      { listId: list.id },
      { ...LEFT_OUT_FRESH, enabled: open },
    ),
  );
  const [draft, setDraft] = useState<string[] | null>(null);
  const ticks = useLeftOutTicks(
    candidates,
    draft ?? saved?.lists ?? [],
    setDraft,
  );

  const { mutate: save } = useMutation(
    api.smartLists.setLeftOut.mutationOptions({
      onSuccess: (result) => {
        queryClient.setQueryData(
          api.smartLists.leftOut.queryKey({ listId: list.id }),
          result,
        );
        void queryClient.invalidateQueries(api.lists.stats.pathFilter());
        void queryClient.invalidateQueries(
          api.bookmarks.getBookmarks.pathFilter(),
        );
        void queryClient.invalidateQueries(
          api.bookmarks.countBookmarks.pathFilter(),
        );
      },
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );

  const onOpenChange = (next: boolean) => {
    if (!next && draft && saved && !sameSet(draft, saved.lists)) {
      save({ listId: list.id, lists: draft });
    }
    if (!next) {
      setDraft(null);
    }
    setOpen(next);
  };

  return (
    <ChooseListsDialog
      title={list.name}
      description="Pick the lists it shows. A folder brings everything in it; open it to leave single sub-lists out. What's in no list always shows."
      ticks={ticks}
      loading={!saved}
      open={open}
      setOpen={onOpenChange}
    />
  );
}
