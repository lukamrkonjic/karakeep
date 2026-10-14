"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import {
  ChooseListsDialog,
  listCandidates,
  useLeftOutTicks,
} from "@/components/dashboard/lists/ChooseListsDialog";
import { PageOptions } from "@/components/dashboard/PageOptions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useColourLeftOut, useSetColourLeftOut } from "@/lib/leftOutLists";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { cn } from "@/lib/utils";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ListChecks, ListPlus } from "lucide-react";

import {
  useBookmarkLists,
  useCreateBookmarkList,
} from "@karakeep/shared-react/hooks/lists";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  COLOUR_ACCURACY_DEFAULT,
  COLOUR_FAMILIES,
  FAMILY_SWATCHES,
  formatColourRange,
  isColourFamily,
  parseColourQuery,
} from "@karakeep/shared/utils/colours";

import { ColourAccuracy } from "./ColourAccuracy";

/**
 * The pictures with a colour, or a family's colours, a page at a time, as
 * near as `accuracy` asks — none from the lists the colour pages leave out
 * (ColourChooseLists).
 */
function useColourResults(colour: string, accuracy: number) {
  const api = useTRPC();
  return useInfiniteQuery(
    api.pictures.byColour.infiniteQueryOptions(
      { colour, accuracy },
      {
        initialCursor: 0,
        getNextPageParam: (page) => page.nextCursor,
        placeholderData: keepPreviousData,
      },
    ),
  );
}

/** The pictures with a colour in them, the most of it first. */
function ColourResults({
  colour,
  accuracy,
}: {
  colour: string;
  accuracy: number;
}) {
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useColourResults(colour, accuracy);
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
 * The colour pages' "…" → Choose lists…, as the tailored feed picks its
 * lists: one choice for every colour, kept in the account and saved as it's
 * ticked. A smart list of a colour picks its own.
 */
function ColourChooseLists({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { data: lists } = useBookmarkLists();
  const candidates = useMemo(
    () => listCandidates(lists?.data ?? []),
    [lists?.data],
  );
  const setLeftOut = useSetColourLeftOut();
  const ticks = useLeftOutTicks(
    candidates,
    useColourLeftOut(),
    (next) => void setLeftOut(next),
  );
  return (
    <ChooseListsDialog
      title="Colours"
      description="Pick the lists the colour pages show. A folder brings everything in it; open it to leave single sub-lists out."
      ticks={ticks}
      open={open}
      setOpen={setOpen}
    />
  );
}

const nameOf = (family: string) =>
  family.charAt(0).toUpperCase() + family.slice(1);

/**
 * Fork: pictures by colour — a family's (red, beige…: the chips) or one
 * colour's, its lighter and darker shades too (the swatch picks any), the
 * most of it first (routers/pictures.ts byColour), as near as its Accuracy
 * asks (one for every colour page, kept in the account). Saved as a smart
 * list (`color:red`, `color:#ab2b3b~80%`), it's a folder of that colour
 * that keeps itself up to date.
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

  const accuracy = usePreference("colourAccuracy") ?? COLOUR_ACCURACY_DEFAULT;
  const updatePreferences = useUpdatePreferences();
  // The pictures follow the slider's pauses.
  const asked = useDebounce(accuracy, 250);
  const total = useColourResults(query, asked).data?.pages[0]?.total;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { mutate: createList, isPending: saving } = useCreateBookmarkList({
    onSuccess: (list) => router.push(`/dashboard/lists/${list.id}`),
    onError: (e) => toast({ variant: "destructive", description: e.message }),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* On a phone, closer together: the colour's name keeps its room. */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <label
          className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15 sm:size-16"
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
        <div className="min-w-0 flex-1 pl-1 sm:pl-0">
          <h1 className="truncate text-xl font-semibold leading-tight sm:text-2xl">
            {family ? nameOf(family) : query}
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {total === undefined
              ? "Looking…"
              : `${total.toLocaleString()} ${total === 1 ? "picture" : "pictures"}`}
          </p>
        </div>
        <ColourAccuracy
          value={accuracy}
          onChange={(colourAccuracy) =>
            void updatePreferences({ colourAccuracy })
          }
          family={family ? nameOf(family) : undefined}
        />
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
              query: `color:${formatColourRange({ colour: query, accuracy })}`,
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
              id: "lists",
              label: "Choose lists…",
              icon: <ListChecks className="size-4" />,
              onSelect: () => setSettingsOpen(true),
            },
          ]}
          sort={null}
        />
        <ColourChooseLists open={settingsOpen} setOpen={setSettingsOpen} />
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
      <ColourResults colour={query} accuracy={asked} />
    </div>
  );
}
