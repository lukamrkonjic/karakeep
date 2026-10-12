"use client";

import { useMemo, useState } from "react";
import {
  useSetTailoredFeedExcluded,
  useTailoredFeedExcluded,
} from "@/lib/tailoredFeed";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import {
  ChooseListsDialog,
  listCandidates,
  useExcludedTicks,
} from "../lists/ChooseListsDialog";

/** The lists a tailored feed can draw from: your own manual lists. */
export function feedCandidates(lists: ZBookmarkList[]): ZBookmarkList[] {
  return listCandidates(lists);
}

/**
 * The tailored feed's settings: every list as the sidebar's tree, each with a
 * tick (ChooseListsDialog), saved as it's ticked. Ticking a folder takes in
 * (or leaves out) everything inside it; open it to leave out single
 * sub-lists, and the folder shows half-ticked. Opened by its trigger
 * (`children`), or controlled with `open`/`setOpen` (the feed's "…" menu,
 * TailoredFeedOptions).
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
  const candidates = useMemo(
    () => feedCandidates(lists?.data ?? []),
    [lists?.data],
  );
  const ticks = useExcludedTicks(
    candidates,
    useTailoredFeedExcluded(),
    useSetTailoredFeedExcluded(),
  );

  return (
    <ChooseListsDialog
      title="Tailored feed"
      description="Pick the lists your feed is made of. A folder brings everything in it; open it to leave single sub-lists out."
      ticks={ticks}
      open={open}
      setOpen={setOpen}
    >
      {children}
    </ChooseListsDialog>
  );
}
