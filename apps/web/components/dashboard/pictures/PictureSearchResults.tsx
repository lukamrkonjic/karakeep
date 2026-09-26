"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

/** Typing goes to the URL at once; the text model gets the pauses. */
function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Fork: Search → Pictures — the pictures that fit a description, best first
 * (routers/pictures.ts searchByDescription). The first search after a while
 * waits for the workers to load the text model (to download it, the very
 * first time); it shows so and looks again.
 */
export function PictureSearchResults({ query }: { query: string }) {
  const api = useTRPC();
  const text = useSettled(query, 400);
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(
      api.pictures.searchByDescription.infiniteQueryOptions(
        { text },
        {
          initialCursor: 0,
          getNextPageParam: (page) => page.nextCursor,
          placeholderData: keepPreviousData,
          refetchInterval: (q) =>
            q.state.data?.pages[0]?.status === "preparing" ? 2000 : false,
        },
      ),
    );
  if (error) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error.message}
      </p>
    );
  }
  const first = data?.pages[0];
  if (!first) {
    return <BookmarksGridSkeleton />;
  }
  if (first.status === "off") {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Search by description is turned off in{" "}
        <Link
          href="/settings/pictures"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Settings → Pictures
        </Link>
        .
      </p>
    );
  }
  if (first.status === "preparing") {
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Getting the text model ready — the very first time it downloads (0.25
        GB)…
      </p>
    );
  }
  if (!text.trim()) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Describe what&apos;s in the picture — “red armchair”, “comet over a dark
        sea” — to find it, titled or not.
      </p>
    );
  }
  if (first.total === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No picture fits “{text.trim()}” well enough. Settings → Pictures can
        make it less strict.
      </p>
    );
  }
  return (
    <BookmarksGrid
      bookmarks={data.pages.flatMap((page) => page.bookmarks)}
      hasNextPage={hasNextPage}
      fetchNextPage={() => void fetchNextPage()}
      isFetchingNextPage={isFetchingNextPage}
    />
  );
}
