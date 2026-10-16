"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { VranaMark } from "@/components/VranaMark";
import { Input } from "@/components/ui/input";
import { AssetUrlProvider, guestAssetUrl } from "@/lib/assetUrl";
import { isEmojiIcon } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { Eye, Search, X } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";

import type {
  ZGuestShareList,
  ZGuestShareView,
} from "@karakeep/shared/types/guestShares";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";
import { useTRPC } from "@karakeep/shared-react/trpc";

import { GuestGrid } from "./GuestGrid";
import { GuestPreview } from "./GuestPreview";
import { GuestViewOptions } from "./GuestViewOptions";
import { useGuestViewPrefs } from "./useGuestViewPrefs";

/** The link's lists as a tree, each with how deep it sits. */
function treeOf(lists: ZGuestShareList[]) {
  const children = new Map<string | null, ZGuestShareList[]>();
  for (const l of lists) {
    children.set(l.parentId, [...(children.get(l.parentId) ?? []), l]);
  }
  const out: { list: ZGuestShareList; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of children.get(parent) ?? []) {
      out.push({ list: l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A tag as the search bar takes it: #name, or #"two words". */
function tagQuery(name: string) {
  return /\s/.test(name) ? `#"${name.replace(/"/g, "")}"` : `#${name}`;
}

/**
 * Fork: a guest link, as its guest sees it (app/share/[token]) — the lists
 * shared with them (a sidebar; chips on a phone), everything in them or one
 * list at a time, the app's own search within them, and the preview. Where
 * they are is in the address (?list=, ?q=, ?p=), so Back works and a link
 * to one picture opens on it. Nothing here changes anything.
 */
export function GuestShareView({
  token,
  initialView,
}: {
  token: string;
  initialView: ZGuestShareView;
}) {
  const api = useTRPC();
  const { data: view } = useQuery(
    api.guestShares.view.queryOptions(
      { token },
      { initialData: initialView, refetchOnWindowFocus: true },
    ),
  );
  const [listParam, setListParam] = useQueryState("list", {
    history: "push",
  });
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [openId, setOpenId] = useQueryState("p", { history: "push" });
  const [prefs, updatePrefs] = useGuestViewPrefs();

  // A list that isn't (any longer) in the link: everything instead.
  const listId =
    listParam && view.lists.some((l) => l.id === listParam)
      ? listParam
      : undefined;
  const list = view.lists.find((l) => l.id === listId);
  const tree = useMemo(() => treeOf(view.lists), [view.lists]);

  // The box answers at once; the search follows a moment after typing.
  const [typed, setTyped] = useState(q);
  // Moved from elsewhere (Back, a tag): the box follows.
  useEffect(() => {
    if (q.trim() !== typed.trim()) {
      setTyped(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const settled = useDebounce(typed, 300);
  useEffect(() => {
    if (settled.trim() !== q.trim()) {
      void setQ(settled.trim() || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  const text = q.trim();
  const searching = text.length > 0;

  const browse = useInfiniteQuery(
    api.guestShares.bookmarks.infiniteQueryOptions(
      { token, listId, sortOrder: prefs.sortOrder },
      {
        enabled: !searching,
        placeholderData: keepPreviousData,
        initialCursor: null,
        getNextPageParam: (last) => last.nextCursor,
      },
    ),
  );
  const search = useInfiniteQuery(
    api.guestShares.search.infiniteQueryOptions(
      { token, text, listId },
      {
        enabled: searching,
        placeholderData: keepPreviousData,
        initialCursor: 0,
        getNextPageParam: (last) => last.nextCursor,
        // What's in the pictures follows once the server has the words'
        // fingerprint (as the app's own search).
        refetchInterval: (query) =>
          query.state.data?.pages[0]?.pictures === "preparing" ? 1500 : false,
      },
    ),
  );
  const results = searching ? search : browse;
  const bookmarks = useMemo(
    () => results.data?.pages.flatMap((p) => p.bookmarks) ?? [],
    [results.data],
  );
  const total = searching
    ? search.data?.pages[0]?.total
    : (list?.numItems ?? view.numItems);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const pickList = (id: string | null) => {
    void setListParam(id);
    window.scrollTo({ top: 0 });
  };

  return (
    <AssetUrlProvider value={guestAssetUrl(token)}>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => {
                pickList(null);
                void setQ(null);
              }}
              className="flex min-w-0 shrink-0 items-center gap-2.5"
              title="Everything shared"
            >
              <VranaMark className="size-8 shrink-0" />
              <span className="hidden min-w-0 text-left leading-tight sm:block">
                <span className="block truncate font-semibold">
                  {view.ownerName}&apos;s vrana
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="size-3" />
                  Shared with you to look through
                </span>
              </span>
            </button>
            <div className="relative mx-auto w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setTyped("");
                  }
                }}
                placeholder={
                  list ? `Search in ${list.name}` : "Search everything shared"
                }
                aria-label="Search"
                className="h-10 rounded-full bg-muted pl-9 pr-9"
              />
              {typed && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setTyped("");
                    void setQ(null);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <GuestViewOptions
              prefs={prefs}
              update={updatePrefs}
              searching={searching}
            />
          </div>
          {/* On a phone the lists are chips under the search. */}
          <nav
            aria-label="Lists"
            className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none] md:hidden"
          >
            <ListChip active={!listId} onClick={() => pickList(null)}>
              Everything
            </ListChip>
            {tree.map(({ list: l }) => (
              <ListChip
                key={l.id}
                active={l.id === listId}
                onClick={() => pickList(l.id)}
              >
                {isEmojiIcon(l.icon) && <span>{l.icon}</span>}
                {l.name}
              </ListChip>
            ))}
          </nav>
        </header>

        <div className="flex">
          <aside className="sticky top-[65px] hidden h-[calc(100vh-65px)] w-64 shrink-0 overflow-y-auto border-r px-3 py-4 md:block">
            <SidebarRow
              active={!listId}
              onClick={() => pickList(null)}
              count={view.numItems}
            >
              Everything
            </SidebarRow>
            <div className="mt-3 space-y-0.5">
              {tree.map(({ list: l, depth }) => (
                <SidebarRow
                  key={l.id}
                  active={l.id === listId}
                  onClick={() => pickList(l.id)}
                  count={l.numItems}
                  depth={depth}
                >
                  <span className="w-5 shrink-0 text-center">
                    {isEmojiIcon(l.icon) ? l.icon : "•"}
                  </span>
                  <span className="truncate">{l.name}</span>
                </SidebarRow>
              ))}
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-2 py-4 sm:px-6">
            <div className="mb-4 px-2 sm:px-0">
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                {list && isEmojiIcon(list.icon) && <span>{list.icon}</span>}
                <span className="truncate">
                  {searching ? `“${text}”` : (list?.name ?? "Everything")}
                </span>
              </h1>
              <p className="text-sm text-muted-foreground">
                {/* The header has no room for whose it is on a phone. */}
                <span className="sm:hidden">Shared by {view.ownerName} · </span>
                {searching && list ? `In ${list.name} · ` : ""}
                {total === undefined
                  ? "…"
                  : `${total} ${total === 1 ? "item" : "items"}`}
              </p>
              {!searching && list?.description && (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {list.description}
                </p>
              )}
            </div>
            {view.lists.length === 0 ? (
              <Empty>Nothing is shared in this link yet.</Empty>
            ) : results.isPending ? (
              <Empty>Loading…</Empty>
            ) : bookmarks.length === 0 ? (
              <Empty>
                {searching ? "Nothing matches that." : "This list is empty."}
              </Empty>
            ) : (
              <div
                className={cn(
                  "transition-opacity",
                  results.isPlaceholderData && "opacity-60",
                )}
              >
                <GuestGrid
                  bookmarks={bookmarks}
                  columns={prefs.columns}
                  phoneColumns={prefs.phoneColumns}
                  hasNextPage={!!hasNextPage}
                  fetchNextPage={loadMore}
                  isFetchingNextPage={isFetchingNextPage}
                  onOpen={(id) => void setOpenId(id)}
                />
                {!hasNextPage && searching && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No more results
                  </p>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
      {openId && (
        <GuestPreview
          token={token}
          bookmarkId={openId}
          loaded={bookmarks}
          lists={view.lists}
          onClose={() => void setOpenId(null)}
          // Stepping through replaces the address: Back still closes it.
          onGo={(id) => void setOpenId(id, { history: "replace" })}
          onTag={(tag) => {
            void setOpenId(null);
            setTyped(tagQuery(tag));
            void setQ(tagQuery(tag));
          }}
          onList={(id) => {
            void setOpenId(null);
            void setQ(null);
            pickList(id);
          }}
          nearEnd={loadMore}
        />
      )}
    </AssetUrlProvider>
  );
}

function SidebarRow({
  active,
  onClick,
  count,
  depth = 0,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  depth?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{ paddingLeft: `${0.5 + depth}rem` }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">{children}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

function ListChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-24 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
