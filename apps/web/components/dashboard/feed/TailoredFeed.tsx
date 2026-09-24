"use client";

import { useMemo } from "react";
import ClientBookmarksGrid from "@/components/dashboard/bookmarks/ClientBookmarksGrid";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { useTailoredFeedExcluded } from "@/lib/tailoredFeed";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import { TailoredFeedOptions } from "./TailoredFeedOptions";
import { feedCandidates } from "./TailoredFeedSettings";

/**
 * Everything in the lists you picked for the feed (see TailoredFeedSettings),
 * as one grid, in the order its "…" menu sets. The choice is the
 * account's, so every device shows the same feed.
 */
export default function TailoredFeed({
  initialLists,
}: {
  /** The server's lists, so its render and the browser's first one agree
   *  (the browser used to have them already — the sidebar's — and the
   *  server didn't: a hydration mismatch). */
  initialLists?: { lists: ZBookmarkList[] };
}) {
  const excluded = useTailoredFeedExcluded();
  const { data: lists } = useBookmarkLists(undefined, {
    initialData: initialLists,
  });

  const candidates = useMemo(
    () => feedCandidates(lists?.data ?? []),
    [lists?.data],
  );
  const listIds = useMemo(() => {
    const out = new Set(excluded);
    return candidates.filter((l) => !out.has(l.id)).map((l) => l.id);
  }, [candidates, excluded]);

  if (!lists) {
    return <FullPageSpinner />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-2xl">Tailored feed</p>
          <p className="text-sm text-muted-foreground">
            {listIds.length === candidates.length
              ? `All ${candidates.length} lists`
              : `${listIds.length} of ${candidates.length} lists`}
          </p>
        </div>
        <TailoredFeedOptions variant="header" />
      </div>
      {listIds.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No lists in your feed yet. Pick some with “…” → Choose lists.
        </p>
      ) : (
        <ClientBookmarksGrid
          query={{ listIds, archived: false }}
          sortKey="feed"
        />
      )}
    </div>
  );
}
