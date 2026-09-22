import type { SQL } from "drizzle-orm";
import type { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { zGetBookmarksRequestSchema } from "@karakeep/shared/types/bookmarks";
import type { ZCursor } from "@karakeep/shared/types/pagination";
import {
  bookmarks,
  bookmarksInLists,
  rssFeedImportsTable,
  tagsOnBookmarks,
} from "@karakeep/db/schema";

import type { AuthedContext } from "../index";

/**
 * Fork: orders beyond upstream's newest/oldest, for getBookmarks (`sortBy`):
 *
 * - `random`: a shuffle that holds still while you scroll. Each item's place
 *   comes from a hash of its id and `shuffleSeed`, and the page picks a new
 *   seed every time it loads — so a refresh reshuffles everything, not just
 *   the first page.
 * - `addedToList`: when each bookmark joined the list (for a list shown with
 *   its sub-lists, or the tailored feed, the latest of its lists), newest
 *   first. Rows from before that date was recorded fall back to when the
 *   bookmark was saved.
 *
 * Both need the whole matching set in order, so the ids and their sort keys
 * are read in one query, ordered here, and a page is the run after the
 * cursor. The cursor holds the last item's sort key, not an offset: moving a
 * bookmark out while you scroll (drag-and-drop moves) neither repeats nor
 * skips anything. It travels in the usual cursor shape, with the key as JSON
 * in `id`, so clients (and the REST API) never see a different type.
 */

type Input = z.infer<typeof zGetBookmarksRequestSchema> & { ids?: string[] };

interface Row {
  id: string;
  createdAt: Date;
  addedAt: Date | null;
}

type Key = [number, number, string];

/** cyrb53 (public domain): a fast, well-mixed 53-bit string hash. */
function hash(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function compare(a: Key, b: Key): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

/** Ascending keys = the order the page shows. */
function keyOf(row: Row, input: Input): Key {
  if (input.sortBy === "random") {
    return [hash(row.id, input.shuffleSeed ?? 0), 0, row.id];
  }
  const added = row.addedAt ?? row.createdAt;
  return [-added.getTime(), -row.createdAt.getTime(), row.id];
}

function parseCursor(cursor: ZCursor | null | undefined): Key | null {
  if (!cursor) {
    return null;
  }
  try {
    const key = JSON.parse(cursor.id) as unknown;
    return Array.isArray(key) && key.length === 3 ? (key as Key) : null;
  } catch {
    return null; // a cursor from another order: start over
  }
}

/** Every bookmark the input matches, with what the orders sort on. */
async function matchingRows(ctx: AuthedContext, input: Input): Promise<Row[]> {
  const common: (SQL | undefined)[] = [
    input.archived !== undefined
      ? eq(bookmarks.archived, input.archived)
      : undefined,
    input.favourited !== undefined
      ? eq(bookmarks.favourited, input.favourited)
      : undefined,
    input.ids ? inArray(bookmarks.id, input.ids) : undefined,
  ];
  const ownOnly = eq(bookmarks.userId, ctx.user.id);
  const withoutAdded = (rows: { id: string; createdAt: Date }[]) =>
    rows.map((r) => ({ ...r, addedAt: null }));

  if (input.listId !== undefined) {
    // No owner filter, as on loadMulti's list path: a shared list shows its
    // owner's bookmarks. loadMulti has checked access with List.fromId.
    return ctx.db
      .select({
        id: bookmarks.id,
        createdAt: bookmarks.createdAt,
        addedAt: bookmarksInLists.addedAt,
      })
      .from(bookmarksInLists)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarksInLists.bookmarkId))
      .where(and(eq(bookmarksInLists.listId, input.listId), ...common));
  }
  if (input.tagId !== undefined) {
    return withoutAdded(
      await ctx.db
        .select({ id: bookmarks.id, createdAt: bookmarks.createdAt })
        .from(tagsOnBookmarks)
        .innerJoin(bookmarks, eq(bookmarks.id, tagsOnBookmarks.bookmarkId))
        .where(and(eq(tagsOnBookmarks.tagId, input.tagId), ownOnly, ...common)),
    );
  }
  if (input.rssFeedId !== undefined) {
    return withoutAdded(
      await ctx.db
        .select({ id: bookmarks.id, createdAt: bookmarks.createdAt })
        .from(rssFeedImportsTable)
        .innerJoin(bookmarks, eq(bookmarks.id, rssFeedImportsTable.bookmarkId))
        .where(
          and(
            eq(rssFeedImportsTable.rssFeedId, input.rssFeedId),
            ownOnly,
            ...common,
          ),
        ),
    );
  }

  const allTags = input.tagIds?.length
    ? inArray(
        bookmarks.id,
        ctx.db
          .select({ id: tagsOnBookmarks.bookmarkId })
          .from(tagsOnBookmarks)
          .where(inArray(tagsOnBookmarks.tagId, input.tagIds))
          .groupBy(tagsOnBookmarks.bookmarkId)
          .having(
            sql`count(distinct ${tagsOnBookmarks.tagId}) = ${new Set(input.tagIds).size}`,
          ),
      )
    : undefined;

  if (input.listIds) {
    // In any of these lists, once, with the latest time it joined one.
    const added = ctx.db
      .select({
        bookmarkId: bookmarksInLists.bookmarkId,
        addedAt: sql<number | null>`max(${bookmarksInLists.addedAt})`.as(
          "addedAt",
        ),
      })
      .from(bookmarksInLists)
      .where(inArray(bookmarksInLists.listId, input.listIds))
      .groupBy(bookmarksInLists.bookmarkId)
      .as("added");
    const rows = await ctx.db
      .select({
        id: bookmarks.id,
        createdAt: bookmarks.createdAt,
        addedAt: added.addedAt,
      })
      .from(bookmarks)
      .innerJoin(added, eq(added.bookmarkId, bookmarks.id))
      .where(and(ownOnly, ...common, allTags));
    // The raw column holds seconds.
    return rows.map((r) => ({
      ...r,
      addedAt: r.addedAt === null ? null : new Date(Number(r.addedAt) * 1000),
    }));
  }

  return withoutAdded(
    await ctx.db
      .select({ id: bookmarks.id, createdAt: bookmarks.createdAt })
      .from(bookmarks)
      .where(and(ownOnly, ...common, allTags)),
  );
}

/**
 * One page in a fork order. `loadPage` loads full bookmarks for the page's
 * ids (loadMulti on its usual path, so access rules stay the same); they're
 * put back in this order before returning.
 */
export async function loadInForkOrder<T extends { id: string }>(
  ctx: AuthedContext,
  input: Input,
  loadPage: (ids: string[]) => Promise<{ bookmarks: T[] }>,
): Promise<{ bookmarks: T[]; nextCursor: ZCursor | null }> {
  const limit = input.limit ?? 20;
  const ordered = (await matchingRows(ctx, input))
    .map((row) => ({ id: row.id, key: keyOf(row, input) }))
    .sort((a, b) => compare(a.key, b.key));

  const after = parseCursor(input.cursor);
  let start = 0;
  if (after) {
    start = ordered.findIndex((entry) => compare(entry.key, after) > 0);
    if (start === -1) {
      start = ordered.length;
    }
  }
  const page = ordered.slice(start, start + limit);
  if (page.length === 0) {
    return { bookmarks: [], nextCursor: null };
  }

  const { bookmarks: loaded } = await loadPage(page.map((entry) => entry.id));
  const position = new Map(page.map((entry, i) => [entry.id, i]));
  loaded.sort((a, b) => position.get(a.id)! - position.get(b.id)!);

  const last = page[page.length - 1];
  return {
    bookmarks: loaded,
    nextCursor:
      start + limit < ordered.length
        ? { createdAt: new Date(0), id: JSON.stringify(last.key) }
        : null,
  };
}
