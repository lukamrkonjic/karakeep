"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";

import { useCreateBookmarkList } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  COLOUR_FAMILIES,
  FAMILY_ICONS,
  FAMILY_SWATCHES,
  isColourFamily,
  parseColourQuery,
} from "@karakeep/shared/utils/colours";

/** The pictures with a colour, or a family's colours, a page at a time. */
function useColourResults(colour: string) {
  const api = useTRPC();
  return useInfiniteQuery(
    api.pictures.byColour.infiniteQueryOptions(
      { colour },
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

const nameOf = (family: string) =>
  family.charAt(0).toUpperCase() + family.slice(1);

/**
 * Fork: pictures by colour — a family's (red, beige…: the chips) or one
 * colour's, its lighter and darker shades too (the swatch picks any), the
 * most of it first (routers/pictures.ts byColour). Saved as a smart list
 * (`color:red`), it's a folder of that colour that keeps itself up to date.
 */
export default function ColourPage({ colour: param }: { colour: string }) {
  const router = useRouter();
  const query = parseColourQuery(param) ?? "#286ff0";
  const family = isColourFamily(query) ? query : null;
  const shown = family ? FAMILY_SWATCHES[family] : query;
  const [picked, setPicked] = useState(shown);
  useEffect(() => setPicked(shown), [shown]);
  // A picker sends colours while it's dragged: the page follows the pauses.
  useEffect(() => {
    if (picked === shown) {
      return;
    }
    const timer = setTimeout(
      () => router.replace(`/dashboard/colour/${picked.slice(1)}`),
      300,
    );
    return () => clearTimeout(timer);
  }, [picked, shown, router]);

  const total = useColourResults(query).data?.pages[0]?.total;
  const { mutate: createList, isPending: saving } = useCreateBookmarkList({
    onSuccess: (list) => router.push(`/dashboard/lists/${list.id}`),
    onError: (e) => toast({ variant: "destructive", description: e.message }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <label
          className="relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15"
          style={{ backgroundColor: picked }}
          title="Pick a colour"
        >
          <input
            type="color"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Colour"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold leading-tight">
            {family ? nameOf(family) : query}
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {total === undefined
              ? "Looking…"
              : `${total.toLocaleString()} ${total === 1 ? "picture" : "pictures"}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          disabled={saving}
          title={`A smart list of the pictures in ${family ?? query}, kept up to date`}
          onClick={() =>
            createList({
              name: family ? nameOf(family) : query,
              icon: family ? FAMILY_ICONS[family] : "🎨",
              type: "smart",
              query: `color:${query}`,
            })
          }
        >
          <ListPlus className="size-4" />
          <span className="hidden sm:inline">Save as smart list</span>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {COLOUR_FAMILIES.map((f) => (
          <Link
            key={f}
            href={`/dashboard/colour/${f}`}
            title={nameOf(f)}
            aria-label={nameOf(f)}
            className={cn(
              "size-7 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 dark:ring-white/15",
              f === family &&
                "ring-2 ring-foreground ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: FAMILY_SWATCHES[f] }}
          />
        ))}
      </div>
      <ColourResults colour={query} />
    </div>
  );
}
