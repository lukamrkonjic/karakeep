"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { normalizeHex } from "@karakeep/shared/utils/colours";

/** The pictures with a colour in them, a page at a time. */
function useColourResults(colour: string) {
  const api = useTRPC();
  return useInfiniteQuery(
    api.pictures.byColour.infiniteQueryOptions(
      { hex: colour },
      {
        initialCursor: 0,
        getNextPageParam: (page) => page.nextCursor,
        placeholderData: keepPreviousData,
      },
    ),
  );
}

/**
 * The pictures with a colour in them, the most of it first — also what
 * Search → Pictures shows for a colour typed as #rrggbb.
 */
export function ColourResults({ colour }: { colour: string }) {
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useColourResults(colour);
  if (error) {
    throw error;
  }
  if (!data) {
    return <BookmarksGridSkeleton />;
  }
  if (data.pages[0]?.total === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing in this colour — or the colours aren&apos;t read yet (Settings →
        Pictures).
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

/**
 * Fork: search by colour — every picture with some of a colour (its lighter
 * and darker shades too), the most of it first (routers/pictures.ts
 * byColour). The swatch picks another colour.
 */
export default function ColourPage({ hex }: { hex: string }) {
  const router = useRouter();
  const colour = normalizeHex(hex) ?? "#286ff0";
  const [picked, setPicked] = useState(colour);
  useEffect(() => setPicked(colour), [colour]);
  // A picker sends colours while it's dragged: the page follows the pauses.
  useEffect(() => {
    if (picked === colour) {
      return;
    }
    const timer = setTimeout(
      () => router.replace(`/dashboard/colour/${picked.slice(1)}`),
      300,
    );
    return () => clearTimeout(timer);
  }, [picked, colour, router]);

  const total = useColourResults(colour).data?.pages[0]?.total;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <label
          className="relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15"
          style={{ backgroundColor: picked }}
          title="Pick another colour"
        >
          <input
            type="color"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Colour"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold leading-tight">
            Colour
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {total === undefined
              ? "Looking…"
              : `${total.toLocaleString()} ${total === 1 ? "picture" : "pictures"} in ${colour}`}
          </p>
        </div>
      </div>
      <ColourResults colour={colour} />
    </div>
  );
}
