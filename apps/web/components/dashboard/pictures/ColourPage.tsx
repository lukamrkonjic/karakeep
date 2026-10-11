"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { LeaveListsOutDialog } from "@/components/dashboard/lists/LeaveListsOutDialog";
import { PageOptions } from "@/components/dashboard/PageOptions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useColourLeftOut, useSetColourLeftOut } from "@/lib/leftOutLists";
import { cn } from "@/lib/utils";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ListPlus, ListX, X } from "lucide-react";

import {
  useBookmarkLists,
  useCreateBookmarkList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  compileSmartRules,
  withSmartRulesLeftOut,
} from "@karakeep/shared/smartListRules";
import {
  COLOUR_FAMILIES,
  FAMILY_SWATCHES,
  isColourFamily,
  parseColourQuery,
} from "@karakeep/shared/utils/colours";

/**
 * The pictures with a colour, or a family's colours, a page at a time —
 * none from the lists every colour page leaves out.
 */
function useColourResults(colour: string) {
  const api = useTRPC();
  const leftOut = useColourLeftOut();
  return useInfiniteQuery(
    api.pictures.byColour.infiniteQueryOptions(
      leftOut.length > 0 ? { colour, leaveOut: leftOut } : { colour },
      {
        initialCursor: 0,
        getNextPageParam: (page) => page.nextCursor,
        placeholderData: keepPreviousData,
      },
    ),
  );
}

/** The pictures with a colour in them, the most of it first. */
function ColourResults({ colour }: { colour: string }) {
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
 * The lists left out, over the grid, so a colour never passes for all of
 * it: a tap opens the picker, × brings them all back.
 */
function LeftOutChip({ onOpen }: { onOpen: () => void }) {
  const leftOut = useColourLeftOut();
  const setLeftOut = useSetColourLeftOut();
  const { data: lists } = useBookmarkLists();
  if (leftOut.length === 0) {
    return null;
  }
  const names = leftOut.flatMap((id) => {
    const name = lists?.data.find((l) => l.id === id)?.name;
    return name ? [name] : [];
  });
  const label =
    names.length > 0 && names.length === leftOut.length && names.length <= 2
      ? names.join(", ")
      : `${leftOut.length} ${leftOut.length === 1 ? "list" : "lists"}`;
  return (
    <span className="flex h-7 w-fit max-w-full items-center gap-1.5 rounded-full border bg-muted/50 pl-2.5 pr-1 text-sm">
      <button
        type="button"
        onClick={onOpen}
        title="Choose the lists colours leave out"
        className="flex min-w-0 items-center gap-1.5"
      >
        <ListX className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">Without {label}</span>
      </button>
      <button
        type="button"
        title="Show every list's pictures"
        aria-label="Show every list's pictures"
        onClick={() => setLeftOut([])}
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

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
  // The family chip just tapped takes the ring at once, before its page
  // has loaded — a tap is answered where the finger is.
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => setTapped(null), [query]);
  const ringed = tapped ?? family;
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
  const leftOut = useColourLeftOut();
  const setLeftOut = useSetColourLeftOut();
  const [pickerOpen, setPickerOpen] = useState(false);
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
              // No emoji of its own: one can be picked in its settings.
              icon: "",
              type: "smart",
              // The lists left out here stay out of it: its Lists rule.
              query:
                compileSmartRules(
                  withSmartRulesLeftOut(
                    {
                      groups: [
                        {
                          match: "all",
                          negate: false,
                          rules: [{ field: "colour", op: "is", value: query }],
                        },
                      ],
                    },
                    leftOut,
                  ),
                ).query ?? `color:${query}`,
            })
          }
        >
          <ListPlus className="size-4" />
          <span className="hidden sm:inline">Save as smart list</span>
        </Button>
        <PageOptions
          variant="header"
          label="Colour options"
          items={[
            {
              id: "leave-out",
              label: "Leave lists out…",
              icon: <ListX className="size-4" />,
              onSelect: () => setPickerOpen(true),
            },
          ]}
          sort={null}
        />
        <LeaveListsOutDialog
          open={pickerOpen}
          setOpen={setPickerOpen}
          leftOut={leftOut}
          onSave={setLeftOut}
          description="Pictures in a list you untick don't show on any colour page. Unticking a folder leaves out everything in it; open it to keep single sub-lists."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {COLOUR_FAMILIES.map((f) => (
          <Link
            key={f}
            href={`/dashboard/colour/${f}`}
            title={nameOf(f)}
            aria-label={nameOf(f)}
            onClick={(e) => {
              // Not when it opens in another tab.
              if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                setTapped(f);
              }
            }}
            className={cn(
              // A finger gets the gap around a chip too (after:), so the
              // chips are 36px to aim at, not 28.
              "relative size-7 rounded-full ring-1 ring-inset ring-black/10 transition-transform after:absolute after:-inset-1 after:rounded-full hover:scale-110 dark:ring-white/15",
              f === ringed &&
                "ring-2 ring-foreground ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: FAMILY_SWATCHES[f] }}
          />
        ))}
      </div>
      <LeftOutChip onOpen={() => setPickerOpen(true)} />
      <ColourResults colour={query} />
    </div>
  );
}
