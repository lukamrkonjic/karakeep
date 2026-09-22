"use client";

import { useState } from "react";
import ClientBookmarksGrid from "@/components/dashboard/bookmarks/ClientBookmarksGrid";
import { BookmarkPageOptions } from "@/components/dashboard/PageOptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";

import type { ZGetTagResponse } from "@karakeep/shared/types/tags";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";
import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Find things by their tags: narrow the tag cloud by typing, click tags to
 * pick them, and everything carrying ALL the picked tags shows below. The
 * picked tags live in the URL (?with=…), so a filter can be bookmarked and
 * survives the back button. Tag management is one click away (onManage).
 */
export default function TagFilterView({ onManage }: { onManage: () => void }) {
  const api = useTRPC();
  const [picked, setPicked] = useQueryState(
    "with",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [searchRaw, setSearch] = useState("");
  const search = useDebounce(searchRaw.trim(), 150);

  const { data: matches, isFetching } = useQuery(
    api.tags.list.queryOptions(
      { nameContains: search || undefined, sortBy: "usage", limit: 120 },
      { placeholderData: keepPreviousData },
    ),
  );
  // The picked tags' names, whatever the cloud is currently narrowed to.
  const { data: pickedInfo } = useQuery(
    api.tags.list.queryOptions(
      { ids: picked, limit: 100 },
      { enabled: picked.length > 0, placeholderData: keepPreviousData },
    ),
  );

  const byId = new Map<string, ZGetTagResponse>();
  for (const t of [...(matches?.tags ?? []), ...(pickedInfo?.tags ?? [])]) {
    byId.set(t.id, t);
  }
  const pickedTags = picked
    .map((id) => byId.get(id))
    .filter((t): t is ZGetTagResponse => !!t);
  const choices = (matches?.tags ?? []).filter((t) => !picked.includes(t.id));

  const toggle = (id: string) =>
    void setPicked(
      picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id],
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xl">Tags</span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="bg-background"
            onClick={onManage}
          >
            Manage tags
          </Button>
          <BookmarkPageOptions
            variant="header"
            label="Tags options"
            pageKey="tags"
          />
        </div>
      </div>

      <Input
        type="search"
        value={searchRaw}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter tags…"
        aria-label="Filter tags"
        startIcon={<Search className="h-4 w-4 text-muted-foreground" />}
        endIcon={isFetching && <Spinner className="h-4 w-4" />}
        autoComplete="off"
        className="h-10"
      />

      {pickedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pickedTags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              title={`Remove ${t.name}`}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground transition-opacity hover:opacity-80"
            >
              {t.name}
              <X className="size-3.5" />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => void setPicked([])}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {choices.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => toggle(t.id)}
            className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-foreground transition-colors hover:bg-accent"
          >
            {t.name}
            <span className="text-xs text-muted-foreground">
              {t.numBookmarks}
            </span>
          </button>
        ))}
        {matches && choices.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {search ? `No tags match "${search}".` : "No more tags."}
          </p>
        )}
      </div>

      {picked.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Tagged {pickedTags.map((t) => t.name).join(" + ")}
          </p>
          <ClientBookmarksGrid
            query={{ tagIds: picked, archived: false }}
            sortKey="tags"
          />
        </div>
      ) : (
        <p className="py-10 text-center text-muted-foreground">
          Pick one or more tags to see everything that carries all of them.
        </p>
      )}
    </div>
  );
}
