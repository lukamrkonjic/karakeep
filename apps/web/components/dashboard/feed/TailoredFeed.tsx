"use client";

import { useEffect, useMemo, useState } from "react";
import ClientBookmarksGrid from "@/components/dashboard/bookmarks/ClientBookmarksGrid";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { useTailoredFeed } from "@/lib/tailoredFeed";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";

import { TailoredFeedOptions } from "./TailoredFeedOptions";
import { feedCandidates } from "./TailoredFeedSettings";

/**
 * Everything in the lists you picked for the feed (see TailoredFeedSettings),
 * as one grid, in the order its "…" menu sets. The choice lives in this
 * browser only, so nothing renders until it has been read.
 */
export default function TailoredFeed() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const excluded = useTailoredFeed((s) => s.excluded);
  const { data: lists } = useBookmarkLists();

  const candidates = useMemo(
    () => feedCandidates(lists?.data ?? []),
    [lists?.data],
  );
  const listIds = useMemo(() => {
    const out = new Set(excluded);
    return candidates.filter((l) => !out.has(l.id)).map((l) => l.id);
  }, [candidates, excluded]);

  if (!mounted || !lists) {
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
