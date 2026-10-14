"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ColourAccuracy } from "@/components/dashboard/pictures/ColourAccuracy";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { isEmojiIcon } from "@/lib/emoji";
import { usePageFilters, useSetPageFilters } from "@/lib/hooks/usePageFilter";
import { useTranslation } from "@/lib/i18n/client";
import { bookmarkFilterQuery, toggledFilter } from "@/lib/pageFilter";
import { cn } from "@/lib/utils";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { MoreHorizontal, Star } from "lucide-react";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useEditBookmarkList } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  smartListColour,
  withColourAccuracy,
} from "@karakeep/shared/smartListRules";
import { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  COLOUR_ACCURACY_DEFAULT,
  isColourFamily,
} from "@karakeep/shared/utils/colours";

import NewBookmarkDialog from "../bookmarks/NewBookmarkDialog";
import { ListOptions } from "./ListOptions";
import {
  ListCollaboratorsIcons,
  ListPrivacyLabel,
} from "./ListHeaderComponents";
import { ListSubscriptionNote } from "./ListSubscriptionNote";

/**
 * Fork: "★ N starred" beside the count — a link that filters the list to its
 * starred bookmarks (its "…" → Filter → Starred), and back. N is what that
 * shows: in `query` (the list, or with its sub-lists), of the kind the
 * Filter has on.
 */
function StarredLink({
  listId,
  query,
}: {
  listId: string;
  query: Pick<ZGetBookmarksRequest, "listId" | "listIds" | "archived">;
}) {
  const api = useTRPC();
  const pageKey = `list:${listId}`;
  const filters = usePageFilters(pageKey);
  const setFilters = useSetPageFilters();
  const on = filters.includes("starred");
  const { data } = useQuery(
    api.bookmarks.countBookmarks.queryOptions(
      {
        ...query,
        ...bookmarkFilterQuery(filters.filter((f) => f !== "starred")),
        favourited: true,
      },
      { placeholderData: keepPreviousData },
    ),
  );
  if (!on && !data?.count) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        aria-pressed={on}
        title={on ? "Show everything again" : "Show only the starred ones"}
        onClick={() =>
          void setFilters(pageKey, toggledFilter(filters, "starred"))
        }
        className={cn(
          "flex items-center gap-1 underline-offset-2 transition-colors hover:text-foreground hover:underline",
          on && "text-foreground",
        )}
      >
        <Star
          className={cn("size-3.5", on && "fill-amber-400 text-amber-400")}
        />
        {(data?.count ?? 0).toLocaleString()} starred
      </button>
      <span aria-hidden>·</span>
    </>
  );
}

/**
 * Fork: a smart list of a colour (`color:red`, maybe with other rules): its
 * Accuracy, as on the colour pages — but its own, kept in its query
 * (`color:red~70%`) once the slider is still.
 */
function ColourListAccuracy({ list }: { list: ZBookmarkList }) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const query = list.query ?? "";
  const colour = useMemo(() => smartListColour(query), [query]);
  const saved = colour?.accuracy ?? COLOUR_ACCURACY_DEFAULT;
  // Shown until the list has it.
  const [draft, setDraft] = useState<number | null>(null);
  const { mutate: editList } = useEditBookmarkList({
    onSuccess: () =>
      void queryClient.invalidateQueries(api.lists.stats.pathFilter()),
    onError: (e) => {
      setDraft(null);
      toast({ variant: "destructive", description: e.message });
    },
  });
  useEffect(() => {
    if (draft === null) {
      return;
    }
    if (draft === saved) {
      setDraft(null);
      return;
    }
    const timer = setTimeout(() => {
      const next = withColourAccuracy(query, draft);
      if (next) {
        editList({ listId: list.id, query: next });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, saved, query, list.id, editList]);
  if (!colour) {
    return null;
  }
  return (
    <ColourAccuracy
      value={draft ?? saved}
      onChange={setDraft}
      className="mr-1"
      family={
        isColourFamily(colour.colour)
          ? colour.colour.charAt(0).toUpperCase() + colour.colour.slice(1)
          : undefined
      }
    />
  );
}

export default function ListHeader({
  initialData,
  query,
}: {
  initialData: ZBookmarkList;
  /** What the page shows (the list, or with its sub-lists). */
  query?: Pick<ZGetBookmarksRequest, "listId" | "listIds" | "archived">;
}) {
  const api = useTRPC();
  const { t } = useTranslation();
  const router = useRouter();
  const { data: list, error } = useQuery(
    api.lists.get.queryOptions(
      {
        listId: initialData.id,
      },
      {
        initialData,
      },
    ),
  );

  const { data: statsData } = useQuery(
    api.lists.stats.queryOptions(undefined, {
      placeholderData: keepPreviousData,
    }),
  );
  const itemCount = statsData?.stats.get(list.id);

  if (error) {
    // This is usually exercised during list deletions.
    if (error.data?.code == "NOT_FOUND") {
      router.push("/dashboard/bookmarks");
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        {isEmojiIcon(list.icon) && (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl">
            {list.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold leading-tight">
            {list.name}
          </h1>
          {list.description && (
            <p className="mt-1 text-muted-foreground">{list.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {itemCount !== undefined && (
              <>
                <span>{t("lists.items_count", { count: itemCount })}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <StarredLink
              listId={list.id}
              query={query ?? { listId: list.id }}
            />
            <ListPrivacyLabel list={list} />
            <ListSubscriptionNote list={list} />
            <ListCollaboratorsIcons list={list} />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {list.type === "smart" &&
          (list.userRole === "owner" || list.userRole === "editor") && (
            <ColourListAccuracy list={list} />
          )}
        {list.type === "manual" && <NewBookmarkDialog />}
        <ListOptions list={list}>
          <Button variant="ghost">
            <MoreHorizontal />
          </Button>
        </ListOptions>
      </div>
    </div>
  );
}
