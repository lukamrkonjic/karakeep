import { TRPCError } from "@trpc/server";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import { bookmarks, pictureSeenTable } from "@karakeep/db/schema";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { pickDiscoveries } from "../lib/discover";
import { userPictureIndex, vectorOf } from "../lib/pictureIndex";
import { Bookmark } from "../models/bookmarks";

/**
 * Fork: Discover — the user's own pictures they haven't seen in a while,
 * picked by what they've saved, liked and opened lately (lib/discover.ts).
 * A new set each day, or on Shuffle, kept in pictureSeen with when it was
 * shown, so the next ones are others; opening a picture anywhere counts as
 * seeing it. Nothing leaves the library: no job, no network.
 */

const discoverProcedure = createScopedAuthedProcedure("bookmarks");

const DAY = 24 * 3600_000;
/** A set: this many, of which a few are wildcards from anywhere. */
const SET = 60;
const WILDCARDS = 12;
/** Saved, liked or opened within this: what the user is into lately. */
const LATELY = 30 * DAY;
/** Neither saved nor opened within this: not seen in a while. */
const A_WHILE = 30 * DAY;
/** Shown by Discover within this: not shown again yet. */
const SHOWN_LATELY = 45 * DAY;
/** Never anything seen within this, however young the library. */
const WEEK = 7 * DAY;
const MAX_TASTE = 400;
const MIN_TASTE = 5;

interface Picture {
  id: string;
  savedAt: number;
  favourited: boolean;
  archived: boolean;
  openedAt: number;
  shownAt: number;
}

/** A new set's pictures, in order (the workers' fingerprints decide). */
async function pickSet(ctx: AuthedContext): Promise<string[]> {
  const now = Date.now();
  const loaded = await userPictureIndex(ctx.db, ctx.user.id);
  if (loaded.index.ids.length === 0) {
    return [];
  }
  const meta = new Map(
    (
      await ctx.db
        .select({
          id: bookmarks.id,
          savedAt: bookmarks.dbCreatedAt,
          favourited: bookmarks.favourited,
          archived: bookmarks.archived,
        })
        .from(bookmarks)
        .where(eq(bookmarks.userId, ctx.user.id))
    ).map((row) => [row.id, row]),
  );
  const seen = new Map(
    (
      await ctx.db
        .select({
          id: pictureSeenTable.bookmarkId,
          openedAt: pictureSeenTable.openedAt,
          discoveredAt: pictureSeenTable.discoveredAt,
        })
        .from(pictureSeenTable)
        .where(eq(pictureSeenTable.userId, ctx.user.id))
    ).map((row) => [row.id, row]),
  );
  const pictures: Picture[] = loaded.index.ids.flatMap((id) => {
    const bookmark = meta.get(id);
    return bookmark
      ? [
          {
            id,
            savedAt: bookmark.savedAt.getTime(),
            favourited: bookmark.favourited,
            archived: bookmark.archived,
            openedAt: seen.get(id)?.openedAt?.getTime() ?? 0,
            shownAt: seen.get(id)?.discoveredAt?.getTime() ?? 0,
          },
        ]
      : [];
  });

  // The taste: what was saved, liked or opened lately — topped up with the
  // newest saves when there's next to nothing. It only steers the picking.
  const lately = (p: Picture) => Math.max(p.savedAt, p.openedAt);
  const taste = pictures
    .filter((p) => p.favourited || lately(p) >= now - LATELY)
    .sort((a, b) => lately(b) - lately(a))
    .slice(0, MAX_TASTE);
  if (taste.length < MIN_TASTE) {
    const have = new Set(taste.map((p) => p.id));
    taste.push(
      ...[...pictures]
        .sort((a, b) => b.savedAt - a.savedAt)
        .filter((p) => !have.has(p.id))
        .slice(0, MIN_TASTE - taste.length),
    );
  }

  // The candidates: not seen in a while (neither saved nor opened) — for a
  // young library, not within a week. Those not shown lately come first;
  // ones shown lately only fill up, so a Shuffle is another set.
  const pool = pictures.filter((p) => !p.archived);
  let candidates = pool.filter((p) => lately(p) < now - A_WHILE);
  if (candidates.length < SET) {
    candidates = pool.filter((p) => lately(p) < now - WEEK);
  }
  return pickDiscoveries({
    candidates: candidates.map((p) => ({
      id: p.id,
      vector: vectorOf(loaded, p.id)!,
      bonus: p.shownAt < now - SHOWN_LATELY ? 1 : 0,
    })),
    taste: taste.map((p) => vectorOf(loaded, p.id)!),
    count: SET,
    wildcards: WILDCARDS,
  });
}

/** Picks a new set and keeps it as the one shown now. */
async function newSet(ctx: AuthedContext) {
  const ids = await pickSet(ctx);
  const at = new Date();
  if (ids.length > 0) {
    await ctx.db
      .insert(pictureSeenTable)
      .values(
        ids.map((bookmarkId, i) => ({
          bookmarkId,
          userId: ctx.user.id,
          discoveredAt: at,
          discoverPosition: i,
        })),
      )
      .onConflictDoUpdate({
        target: pictureSeenTable.bookmarkId,
        set: {
          discoveredAt: at,
          discoverPosition: sql`excluded."discoverPosition"`,
        },
      });
  }
  return { ids, at };
}

/** The set shown now: the pictures shown last, together. */
async function currentSet(ctx: AuthedContext) {
  const [latest] = await ctx.db
    .select({ at: max(pictureSeenTable.discoveredAt) })
    .from(pictureSeenTable)
    .where(eq(pictureSeenTable.userId, ctx.user.id));
  if (!latest?.at) {
    return null;
  }
  const rows = await ctx.db
    .select({ id: pictureSeenTable.bookmarkId })
    .from(pictureSeenTable)
    .where(
      and(
        eq(pictureSeenTable.userId, ctx.user.id),
        eq(pictureSeenTable.discoveredAt, latest.at),
      ),
    )
    .orderBy(asc(pictureSeenTable.discoverPosition));
  return { ids: rows.map((row) => row.id), at: latest.at };
}

export const discoverAppRouter = router({
  /** Today's set — picked on the first look of the day. */
  items: discoverProcedure
    .output(
      z.object({
        bookmarks: z.array(zBookmarkSchema),
        pickedAt: z.date().nullable(),
      }),
    )
    .query(async ({ ctx }) => {
      const current = await currentSet(ctx);
      const set =
        current && current.at.toDateString() === new Date().toDateString()
          ? current
          : await newSet(ctx);
      if (set.ids.length === 0) {
        return { bookmarks: [], pickedAt: null };
      }
      const { bookmarks: loaded } = await Bookmark.loadMulti(ctx, {
        ids: set.ids,
        includeContent: false,
        sortOrder: "desc",
      });
      const order = new Map(set.ids.map((id, i) => [id, i]));
      loaded.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return {
        bookmarks: loaded.map((b) => b.asZBookmark()),
        pickedAt: set.at,
      };
    }),

  /** Shuffle: another set now. */
  shuffle: discoverProcedure.output(z.void()).mutation(async ({ ctx }) => {
    await newSet(ctx);
  }),

  /** Opening a picture is seeing it: Discover leaves it be for a while. */
  opened: discoverProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      const own = await ctx.db.query.bookmarks.findFirst({
        where: and(
          eq(bookmarks.id, input.bookmarkId),
          eq(bookmarks.userId, ctx.user.id),
        ),
        columns: { id: true },
      });
      if (!own) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      const openedAt = new Date();
      await ctx.db
        .insert(pictureSeenTable)
        .values({ bookmarkId: own.id, userId: ctx.user.id, openedAt })
        .onConflictDoUpdate({
          target: pictureSeenTable.bookmarkId,
          set: { openedAt },
        });
    }),
});
