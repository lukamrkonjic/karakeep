import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import type { ZPictureThumb } from "@karakeep/shared/types/pictures";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  pictureEmbeddingsTable,
  pictureJobRunsTable,
  pictureListSuggestionsTable,
  pictureSettingsTable,
  pictureTextQueriesTable,
} from "@karakeep/db/schema";
import {
  bufferToVector,
  clipModelDownloaded,
  getPictureSettings,
  normalizeDescription,
  pictureTextQueryId,
  PictureTextQueue,
  rankPictures,
  requestListSuggestions,
  requestPictureFingerprints,
} from "@karakeep/shared-server";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";
import {
  DESCRIBE_LEVELS,
  SIMILAR_LEVELS,
  zPictureSettingsSchema,
  zPicturesStatusSchema,
  zSuggestedListSchema,
  zSuggestionGroupSchema,
  zUpdatePictureSettingsSchema,
} from "@karakeep/shared/types/pictures";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { userPictureIndex, vectorOf } from "../lib/pictureIndex";
import { getBookmarkIdsFromMatcher } from "../lib/search";
import { Bookmark } from "../models/bookmarks";
import { List, ManualList } from "../models/lists";

/**
 * Fork: Settings → Pictures, and what rests on the pictures' fingerprints
 * (the workers make them: apps/workers/workers/pictures/) — "More like this",
 * search by description, and list suggestions ("Belongs in…").
 */

const picturesProcedure = createScopedAuthedProcedure("bookmarks");

const PAGE = 30;
/** At most this many are ranked for a page of results. */
const MAX_RESULTS = 600;
/** How long a search waits for its description's fingerprint. */
const DESCRIBE_WAIT_MS = 8000;

function chunks<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const zPageOfPictures = z.object({
  bookmarks: z.array(zBookmarkSchema),
  nextCursor: z.number().nullable(),
  // All that match, of which this is a page.
  total: z.number(),
});

/** A page of bookmarks, in the order given. */
async function pageOf(
  ctx: AuthedContext,
  ranked: string[],
  cursor: number,
  limit: number,
) {
  const ids = ranked.slice(cursor, cursor + limit);
  const { bookmarks: loaded } = await Bookmark.loadMulti(ctx, {
    ids,
    includeContent: false,
    sortOrder: "desc",
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  loaded.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return {
    bookmarks: loaded.map((b) => b.asZBookmark()),
    nextCursor: cursor + limit < ranked.length ? cursor + limit : null,
    total: ranked.length,
  };
}

/** What Settings → Pictures shows of a user's settings. */
function settingsOf(row: typeof pictureSettingsTable.$inferSelect) {
  const { userId: _userId, suggestionsSince: _since, ...settings } = row;
  return settings;
}

/**
 * A description's fingerprint: from the cache, or asked of the workers and
 * waited for a while. Null while the workers are on it (the first search
 * loads the text model — downloads it, the very first time).
 */
async function describedVector(
  ctx: AuthedContext,
  description: string,
): Promise<Float32Array | null> {
  const id = pictureTextQueryId(description);
  const find = () =>
    ctx.db.query.pictureTextQueriesTable.findFirst({
      where: eq(pictureTextQueriesTable.id, id),
    });
  let row = await find();
  if (row?.embedding) {
    await ctx.db
      .update(pictureTextQueriesTable)
      .set({ usedAt: new Date() })
      .where(eq(pictureTextQueriesTable.id, id));
    return bufferToVector(row.embedding);
  }
  if (row?.error) {
    // Tried again after a minute.
    if (Date.now() - row.usedAt.getTime() < 60_000) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Couldn't search by description: ${row.error}`,
      });
    }
    await ctx.db
      .update(pictureTextQueriesTable)
      .set({ error: null, usedAt: new Date() })
      .where(eq(pictureTextQueriesTable.id, id));
  } else if (!row) {
    await ctx.db
      .insert(pictureTextQueriesTable)
      .values({ id, text: description })
      .onConflictDoNothing();
  }
  await PictureTextQueue.enqueue(
    { queryId: id },
    { idempotencyKey: `picture-text:${id}` },
  );
  const until = Date.now() + DESCRIBE_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 150));
    row = await find();
    if (row?.embedding) {
      return bufferToVector(row.embedding);
    }
    if (row?.error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Couldn't search by description: ${row.error}`,
      });
    }
  }
  return null;
}

/** The user's picture bookmarks as thumbnails. */
async function thumbsOf(
  ctx: AuthedContext,
  ids: string[],
): Promise<Map<string, ZPictureThumb>> {
  const thumbs = new Map<string, ZPictureThumb>();
  for (const chunk of chunks(ids)) {
    const rows = await ctx.db
      .select({
        bookmarkId: bookmarks.id,
        title: bookmarks.title,
        kind: bookmarkAssets.assetType,
        assetId: bookmarkAssets.assetId,
        // A video's first frame, which its fingerprint is of.
        lookedAt: pictureEmbeddingsTable.assetId,
      })
      .from(bookmarks)
      .innerJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
      .leftJoin(
        pictureEmbeddingsTable,
        eq(pictureEmbeddingsTable.bookmarkId, bookmarks.id),
      )
      .where(
        and(eq(bookmarks.userId, ctx.user.id), inArray(bookmarks.id, chunk)),
      );
    for (const row of rows) {
      if (row.kind !== "image" && row.kind !== "video") {
        continue;
      }
      thumbs.set(row.bookmarkId, {
        bookmarkId: row.bookmarkId,
        title: row.title,
        kind: row.kind,
        imageAssetId:
          row.kind === "video" ? (row.lookedAt ?? row.assetId) : row.assetId,
      });
    }
  }
  return thumbs;
}

/** Suggestions still to act on: open, and not in that list meanwhile. */
function openSuggestions(ctx: AuthedContext) {
  return and(
    eq(pictureListSuggestionsTable.userId, ctx.user.id),
    eq(pictureListSuggestionsTable.status, "open"),
    notExists(
      ctx.db
        .select({ one: sql`1` })
        .from(bookmarksInLists)
        .where(
          and(
            eq(
              bookmarksInLists.bookmarkId,
              pictureListSuggestionsTable.bookmarkId,
            ),
            eq(bookmarksInLists.listId, pictureListSuggestionsTable.listId),
          ),
        ),
    ),
  );
}

const zSuggestionIds = z.array(z.string()).min(1).max(500);

export const picturesAppRouter = router({
  settings: picturesProcedure
    .output(zPictureSettingsSchema)
    .query(async ({ ctx }) =>
      settingsOf(await getPictureSettings(ctx.db, ctx.user.id)),
    ),

  updateSettings: picturesProcedure
    .input(zUpdatePictureSettingsSchema)
    .output(zPictureSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const before = await getPictureSettings(ctx.db, ctx.user.id);
      const turnedOn = input.suggestionsEnabled && !before.suggestionsEnabled;
      const [after] = await ctx.db
        .update(pictureSettingsTable)
        .set({
          ...input,
          // "New pictures" are the ones saved from when it was turned on.
          ...(turnedOn ? { suggestionsSince: new Date() } : {}),
        })
        .where(eq(pictureSettingsTable.userId, ctx.user.id))
        .returning();
      // Looking further back: suggestions for those now.
      const widened =
        input.suggestionsScope !== undefined &&
        input.suggestionsScope !== before.suggestionsScope &&
        input.suggestionsScope !== "new";
      if (after.suggestionsEnabled && widened) {
        await ctx.db
          .update(pictureEmbeddingsTable)
          .set({ suggested: false })
          .where(eq(pictureEmbeddingsTable.userId, ctx.user.id));
        await requestListSuggestions(ctx.db, ctx.user.id);
      }
      return settingsOf(after);
    }),

  status: picturesProcedure
    .output(zPicturesStatusSchema)
    .query(async ({ ctx }) => {
      const runs = await ctx.db.query.pictureJobRunsTable.findMany({
        where: eq(pictureJobRunsTable.userId, ctx.user.id),
      });
      const runOf = (job: "fingerprints" | "suggestions") => {
        const run = runs.find((r) => r.job === job);
        return {
          status: run?.status ?? ("never" as const),
          finishedAt: run?.finishedAt ?? null,
          error: run?.error ?? null,
          detail: run?.detail ?? null,
        };
      };
      const [{ images }] = await ctx.db
        .select({ images: count() })
        .from(bookmarkAssets)
        .innerJoin(bookmarks, eq(bookmarks.id, bookmarkAssets.id))
        .where(
          and(
            eq(bookmarks.userId, ctx.user.id),
            eq(bookmarkAssets.assetType, "image"),
          ),
        );
      // Videos count once they have a first frame to look at.
      const [{ videos }] = await ctx.db
        .select({ videos: sql<number>`count(distinct ${assets.bookmarkId})` })
        .from(assets)
        .where(
          and(
            eq(assets.userId, ctx.user.id),
            eq(assets.assetType, AssetTypes.LINK_VIDEO_THUMBNAIL),
          ),
        );
      const [{ done }] = await ctx.db
        .select({ done: count() })
        .from(pictureEmbeddingsTable)
        .where(eq(pictureEmbeddingsTable.userId, ctx.user.id));
      const [{ open }] = await ctx.db
        .select({ open: count() })
        .from(pictureListSuggestionsTable)
        .where(openSuggestions(ctx));
      return {
        fingerprints: {
          ...runOf("fingerprints"),
          done,
          total: images + videos,
        },
        suggestions: { ...runOf("suggestions"), open },
        models: {
          picture: await clipModelDownloaded("picture"),
          text: await clipModelDownloaded("text"),
        },
      };
    }),

  fingerprintNow: picturesProcedure
    .output(z.void())
    .mutation(async ({ ctx }) => {
      await requestPictureFingerprints(ctx.db, ctx.user.id);
    }),

  suggestNow: picturesProcedure.output(z.void()).mutation(async ({ ctx }) => {
    await requestListSuggestions(ctx.db, ctx.user.id);
  }),

  /** Gets the text model ready (downloads it) before the first search. */
  prepareTextModel: picturesProcedure
    .output(z.void())
    .mutation(async ({ ctx }) => {
      await describedVector(ctx, "a picture").catch(() => null);
    }),

  /** "More like this": the user's pictures most like this one. */
  similar: picturesProcedure
    .input(
      z.object({
        bookmarkId: z.string(),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(60).optional(),
      }),
    )
    .output(zPageOfPictures)
    .query(async ({ ctx, input }) => {
      const settings = await getPictureSettings(ctx.db, ctx.user.id);
      if (!settings.similarEnabled) {
        return { bookmarks: [], nextCursor: null, total: 0 };
      }
      const loaded = await userPictureIndex(ctx.db, ctx.user.id);
      const vector = vectorOf(loaded, input.bookmarkId);
      if (!vector) {
        return { bookmarks: [], nextCursor: null, total: 0 };
      }
      const ranked = rankPictures(loaded.index, vector, {
        minSimilarity: 1 - SIMILAR_LEVELS[settings.similarLevel],
        exclude: new Set([input.bookmarkId]),
        limit: MAX_RESULTS,
      });
      return pageOf(
        ctx,
        ranked.map((r) => r.id),
        input.cursor ?? 0,
        input.limit ?? PAGE,
      );
    }),

  /**
   * Search → Pictures: pictures by what's in them. The search's qualifiers
   * (list:, #tag, is:fav…) narrow it down as they do any search.
   */
  searchByDescription: picturesProcedure
    .input(
      z.object({
        text: z.string().max(1000),
        cursor: z.number().int().min(0).nullish(),
      }),
    )
    .output(
      zPageOfPictures.extend({
        // "preparing": the workers are getting the text model ready.
        status: z.enum(["ready", "preparing", "off"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const none = { bookmarks: [], nextCursor: null, total: 0 };
      const settings = await getPictureSettings(ctx.db, ctx.user.id);
      if (!settings.describeEnabled) {
        return { ...none, status: "off" as const };
      }
      const parsed = parseSearchQuery(input.text);
      const description = normalizeDescription(parsed.text);
      if (!description) {
        return { ...none, status: "ready" as const };
      }
      const vector = await describedVector(ctx, description);
      if (!vector) {
        return { ...none, status: "preparing" as const };
      }
      const allowed = parsed.matcher
        ? new Set(await getBookmarkIdsFromMatcher(ctx, parsed.matcher))
        : null;
      const loaded = await userPictureIndex(ctx.db, ctx.user.id);
      const ranked = rankPictures(loaded.index, vector, {
        minSimilarity: DESCRIBE_LEVELS[settings.describeLevel],
        only: allowed ? (id) => allowed.has(id) : undefined,
        limit: MAX_RESULTS,
      });
      return {
        ...(await pageOf(
          ctx,
          ranked.map((r) => r.id),
          input.cursor ?? 0,
          PAGE,
        )),
        status: "ready" as const,
      };
    }),

  /** "Belongs in…": the lists suggested for one picture. */
  suggestionsFor: picturesProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .output(z.array(zSuggestedListSchema))
    .query(async ({ ctx, input }) => {
      const { suggestionsEnabled } = await getPictureSettings(
        ctx.db,
        ctx.user.id,
      );
      if (!suggestionsEnabled) {
        return [];
      }
      return ctx.db
        .select({
          id: pictureListSuggestionsTable.id,
          listId: bookmarkLists.id,
          name: bookmarkLists.name,
          icon: bookmarkLists.icon,
          score: pictureListSuggestionsTable.score,
        })
        .from(pictureListSuggestionsTable)
        .innerJoin(
          bookmarkLists,
          eq(bookmarkLists.id, pictureListSuggestionsTable.listId),
        )
        .where(
          and(
            openSuggestions(ctx),
            eq(pictureListSuggestionsTable.bookmarkId, input.bookmarkId),
          ),
        )
        .orderBy(sql`${pictureListSuggestionsTable.score} desc`);
    }),

  /** Cleanups → List suggestions: every open one, by list. */
  suggestionGroups: picturesProcedure
    .output(z.object({ groups: z.array(zSuggestionGroupSchema) }))
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: pictureListSuggestionsTable.id,
          bookmarkId: pictureListSuggestionsTable.bookmarkId,
          score: pictureListSuggestionsTable.score,
          listId: bookmarkLists.id,
          name: bookmarkLists.name,
          icon: bookmarkLists.icon,
        })
        .from(pictureListSuggestionsTable)
        .innerJoin(
          bookmarkLists,
          eq(bookmarkLists.id, pictureListSuggestionsTable.listId),
        )
        .where(openSuggestions(ctx))
        .orderBy(sql`${pictureListSuggestionsTable.createdAt} desc`);
      const thumbs = await thumbsOf(ctx, [
        ...new Set(rows.map((r) => r.bookmarkId)),
      ]);
      const groups = new Map<string, z.infer<typeof zSuggestionGroupSchema>>();
      for (const row of rows) {
        const thumb = thumbs.get(row.bookmarkId);
        if (!thumb) {
          continue;
        }
        const group = groups.get(row.listId) ?? {
          list: { id: row.listId, name: row.name, icon: row.icon },
          pictures: [],
        };
        group.pictures.push({
          ...thumb,
          suggestionId: row.id,
          score: row.score,
        });
        groups.set(row.listId, group);
      }
      return {
        groups: [...groups.values()].sort(
          (a, b) => b.pictures.length - a.pictures.length,
        ),
      };
    }),

  /** Adds the pictures to the lists suggested for them. */
  acceptSuggestions: picturesProcedure
    .input(z.object({ ids: zSuggestionIds }))
    .output(z.object({ added: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: pictureListSuggestionsTable.id,
          bookmarkId: pictureListSuggestionsTable.bookmarkId,
          listId: pictureListSuggestionsTable.listId,
        })
        .from(pictureListSuggestionsTable)
        .where(
          and(
            eq(pictureListSuggestionsTable.userId, ctx.user.id),
            inArray(pictureListSuggestionsTable.id, input.ids),
          ),
        );
      let added = 0;
      const lists = new Map<string, List | null>();
      for (const row of rows) {
        if (!lists.has(row.listId)) {
          lists.set(
            row.listId,
            await List.fromId(ctx, row.listId).catch(() => null),
          );
        }
        const list = lists.get(row.listId);
        if (!(list instanceof ManualList)) {
          continue;
        }
        await list.addBookmark(row.bookmarkId);
        added++;
      }
      await ctx.db
        .update(pictureListSuggestionsTable)
        .set({ status: "added" })
        .where(
          and(
            eq(pictureListSuggestionsTable.userId, ctx.user.id),
            inArray(
              pictureListSuggestionsTable.id,
              rows.map((r) => r.id),
            ),
          ),
        );
      return { added };
    }),

  /** Not those lists: never suggested for these pictures again. */
  dismissSuggestions: picturesProcedure
    .input(z.object({ ids: zSuggestionIds }))
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(pictureListSuggestionsTable)
        .set({ status: "dismissed" })
        .where(
          and(
            eq(pictureListSuggestionsTable.userId, ctx.user.id),
            inArray(pictureListSuggestionsTable.id, input.ids),
          ),
        );
    }),
});
