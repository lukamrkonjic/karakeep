import { and, count, eq, inArray, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import type { ZPictureThumb } from "@karakeep/shared/types/pictures";
import type { Matcher } from "@karakeep/shared/types/search";
import {
  bookmarkAssets,
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  discoverItemsTable,
  pictureEmbeddingsTable,
  pictureJobRunsTable,
  pictureListSuggestionsTable,
  picturePalettesTable,
  pictureSettingsTable,
} from "@karakeep/db/schema";
import {
  clipModelDownloaded,
  fingerprintProgress,
  getPictureSettings,
  normalizeDescription,
  paletteProgress,
  rankPictures,
  requestDiscover,
  requestListSuggestions,
  requestPictureFingerprints,
  requestPicturePalettes,
} from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import { EmbeddingClientFactory } from "@karakeep/shared/inference";
import logger from "@karakeep/shared/logger";
import { getSearchClient } from "@karakeep/shared/search";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";
import { zBookmarkSchema, zSortOrder } from "@karakeep/shared/types/bookmarks";
import {
  DESCRIBE_LEVELS,
  SIMILAR_LEVELS,
  zPaletteColourSchema,
  zPictureSettingsSchema,
  zPicturesStatusSchema,
  zSuggestedListSchema,
  zSuggestionGroupSchema,
  zUpdatePictureSettingsSchema,
} from "@karakeep/shared/types/pictures";
import {
  colourQueryMatches,
  colourQueryScore,
  parseColourQuery,
} from "@karakeep/shared/utils/colours";
import { getVectorStoreClient } from "@karakeep/shared/vectorStore";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { userPictureIndex, vectorOf } from "../lib/pictureIndex";
import { describedVector } from "../lib/pictureText";
import { getBookmarkIdsFromMatcher } from "../lib/search";
import { reciprocalRankFusion } from "../lib/searchRanking";
import { Bookmark } from "../models/bookmarks";
import { List, ManualList } from "../models/lists";

/**
 * Fork: Settings → Pictures, and what rests on the pictures' fingerprints
 * (the workers make them: apps/workers/workers/pictures/) — "More like this",
 * search by description, and list suggestions ("Belongs in…") — and on
 * their colours: a picture's palette, and search by colour.
 */

const picturesProcedure = createScopedAuthedProcedure("bookmarks");

const PAGE = 30;
/** At most this many are ranked for a page of results. */
const MAX_RESULTS = 600;
/** A colour is cheap to rank by: everything in it, within reason. */
const MAX_COLOUR_RESULTS = 3000;
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
 * The user's pictures as thumbnails: a picture bookmark's own file, or for a
 * video (a video bookmark, a note or link with one) the first frame its
 * fingerprint is of.
 */
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
        lookedAt: pictureEmbeddingsTable.assetId,
      })
      .from(bookmarks)
      .leftJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
      .leftJoin(
        pictureEmbeddingsTable,
        eq(pictureEmbeddingsTable.bookmarkId, bookmarks.id),
      )
      .where(
        and(eq(bookmarks.userId, ctx.user.id), inArray(bookmarks.id, chunk)),
      );
    for (const row of rows) {
      const picture = row.kind === "image" ? row.assetId : row.lookedAt;
      if (!picture) {
        continue;
      }
      thumbs.set(row.bookmarkId, {
        bookmarkId: row.bookmarkId,
        title: row.title,
        kind: row.kind === "image" ? "image" : "video",
        imageAssetId: picture,
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

/** Words are looked up in at most this many bookmarks, to merge. */
const WORD_RESULTS = 1000;
/**
 * How long the search bar waits for a new description's fingerprint before
 * answering with the rest (it looks again: `pictures: "preparing"`).
 */
const SEARCH_DESCRIBE_WAIT_MS = 1500;
/** By meaning: as searchBookmarks' hybrid search (routers/bookmarks.ts). */
const MEANING_RESULTS = 100;
const MEANING_SCORE_THRESHOLD = 0.6;

/** The colours a query asks for (color:red, #c8a27a), however nested. */
function coloursIn(matcher: Matcher | undefined): string[] {
  switch (matcher?.type) {
    case "color":
      return matcher.inverse ? [] : [matcher.color];
    case "and":
    case "or":
      return matcher.matchers.flatMap(coloursIn);
    default:
      return [];
  }
}

/** Only these (a query's qualifiers), and only the user's. */
function onlyOf(ctx: AuthedContext, allowed: string[] | null) {
  return [
    ...(allowed
      ? [{ type: "in" as const, field: "id" as const, values: allowed }]
      : []),
    { type: "eq" as const, field: "userId" as const, value: ctx.user.id },
  ];
}

/** Bookmarks with the words (the search index), best first. */
async function byWords(
  ctx: AuthedContext,
  words: string,
  allowed: string[] | null,
): Promise<string[]> {
  try {
    const client = await getSearchClient();
    if (!client) {
      return [];
    }
    const found = await client.search({
      query: words,
      filter: onlyOf(ctx, allowed),
      sort: [{ field: "createdAt", order: "desc" }],
      limit: WORD_RESULTS,
    });
    return found.hits.map((hit) => hit.id);
  } catch (e) {
    logger.warn(`[search] Searching the words failed: ${e}`);
    return [];
  }
}

/** Bookmarks close in meaning, where the server has text embeddings. */
async function byMeaning(
  ctx: AuthedContext,
  words: string,
  allowed: string[] | null,
): Promise<string[]> {
  const { experimentalFeatures, embedding } = serverConfig;
  if (
    !experimentalFeatures.semanticSearch ||
    !embedding.enableAutoIndexing ||
    !embedding.isConfigured
  ) {
    return [];
  }
  try {
    const embeddings = EmbeddingClientFactory.build();
    const store = await getVectorStoreClient();
    if (!embeddings || !store) {
      return [];
    }
    const [vector] = (await embeddings.generateEmbeddingFromText([words]))
      .embeddings;
    if (!vector) {
      return [];
    }
    const found = await store.search({
      vector,
      filter: onlyOf(ctx, allowed),
      limit: MEANING_RESULTS,
      rankingScoreThreshold: MEANING_SCORE_THRESHOLD,
    });
    return found.hits.map((hit) => hit.id);
  } catch (e) {
    logger.warn(`[search] Searching by meaning failed: ${e}`);
    return [];
  }
}

/**
 * Pictures the words describe, best first; null while the workers make the
 * description's fingerprint.
 */
async function byDescription(
  ctx: AuthedContext,
  words: string,
  allowed: ReadonlySet<string> | null,
  level: keyof typeof DESCRIBE_LEVELS,
): Promise<string[] | null> {
  const description = normalizeDescription(words);
  if (!description) {
    return [];
  }
  let vector: Float32Array | null;
  try {
    vector = await describedVector(ctx, description, SEARCH_DESCRIBE_WAIT_MS);
  } catch (e) {
    // It's tried again after a minute; the rest answers meanwhile.
    logger.warn(`[search] Searching by description failed: ${e}`);
    return [];
  }
  if (!vector) {
    return null;
  }
  const loaded = await userPictureIndex(ctx.db, ctx.user.id);
  return rankPictures(loaded.index, vector, {
    minSimilarity: DESCRIBE_LEVELS[level],
    only: allowed ? (id) => allowed.has(id) : undefined,
    limit: MAX_RESULTS,
  }).map((r) => r.id);
}

/** Pictures with any of the colours, the most of them first. */
async function byColours(
  ctx: AuthedContext,
  colours: string[],
  allowed: ReadonlySet<string> | null,
): Promise<string[]> {
  if (colours.length === 0) {
    return [];
  }
  const rows = await ctx.db
    .select({
      id: picturePalettesTable.bookmarkId,
      palette: picturePalettesTable.colours,
    })
    .from(picturePalettesTable)
    .where(eq(picturePalettesTable.userId, ctx.user.id));
  return rows
    .filter((row) => !allowed || allowed.has(row.id))
    .map((row) => {
      const palette = row.palette ?? [];
      const scores = colours
        .filter((colour) => colourQueryMatches(palette, colour))
        .map((colour) => colourQueryScore(palette, colour));
      return { id: row.id, match: scores.length ? Math.max(...scores) : -1 };
    })
    .filter((row) => row.match >= 0)
    .sort((a, b) => b.match - a.match)
    .slice(0, MAX_COLOUR_RESULTS)
    .map((row) => row.id);
}

/** These bookmarks (null: all the user's), by when they were saved. */
async function byDate(
  ctx: AuthedContext,
  ids: string[] | null,
  order: "asc" | "desc",
): Promise<string[]> {
  const rows: { id: string; createdAt: Date }[] = [];
  for (const chunk of ids ? chunks(ids) : [null]) {
    rows.push(
      ...(await ctx.db
        .select({ id: bookmarks.id, createdAt: bookmarks.createdAt })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, ctx.user.id),
            chunk ? inArray(bookmarks.id, chunk) : undefined,
          ),
        )),
    );
  }
  const sign = order === "asc" ? 1 : -1;
  return rows
    .sort(
      (a, b) =>
        sign * (a.createdAt.getTime() - b.createdAt.getTime()) ||
        a.id.localeCompare(b.id),
    )
    .map((row) => row.id);
}

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
      // Turned on: the colours, or a first look for new pictures, now.
      if (input.palettesEnabled && !before.palettesEnabled) {
        await requestPicturePalettes(ctx.db, ctx.user.id);
      }
      if (input.discoverEnabled && !before.discoverEnabled) {
        await requestDiscover(ctx.db, ctx.user.id);
      }
      return settingsOf(after);
    }),

  status: picturesProcedure
    .output(zPicturesStatusSchema)
    .query(async ({ ctx }) => {
      const runs = await ctx.db.query.pictureJobRunsTable.findMany({
        where: eq(pictureJobRunsTable.userId, ctx.user.id),
      });
      const runOf = (
        job: "fingerprints" | "suggestions" | "palettes" | "discover",
      ) => {
        const run = runs.find((r) => r.job === job);
        return {
          status: run?.status ?? ("never" as const),
          finishedAt: run?.finishedAt ?? null,
          error: run?.error ?? null,
          detail: run?.detail ?? null,
        };
      };
      // The same pictures the fingerprints job works through.
      const { done, unreadable, total } = await fingerprintProgress(
        ctx.db,
        ctx.user.id,
      );
      const [{ open }] = await ctx.db
        .select({ open: count() })
        .from(pictureListSuggestionsTable)
        .where(openSuggestions(ctx));
      const colours = await paletteProgress(ctx.db, ctx.user.id);
      const [{ fresh }] = await ctx.db
        .select({ fresh: count() })
        .from(discoverItemsTable)
        .where(
          and(
            eq(discoverItemsTable.userId, ctx.user.id),
            eq(discoverItemsTable.status, "new"),
          ),
        );
      return {
        fingerprints: { ...runOf("fingerprints"), done, unreadable, total },
        suggestions: { ...runOf("suggestions"), open },
        palettes: {
          ...runOf("palettes"),
          done: colours.done + colours.unreadable,
          total: colours.total,
        },
        discover: { ...runOf("discover"), fresh },
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

  /** A picture's main colours, the biggest first; none without them. */
  colours: picturesProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .output(z.array(zPaletteColourSchema))
    .query(async ({ ctx, input }) => {
      const { palettesEnabled } = await getPictureSettings(ctx.db, ctx.user.id);
      if (!palettesEnabled) {
        return [];
      }
      const row = await ctx.db.query.picturePalettesTable.findFirst({
        where: and(
          eq(picturePalettesTable.bookmarkId, input.bookmarkId),
          eq(picturePalettesTable.userId, ctx.user.id),
        ),
      });
      return row?.colours ?? [];
    }),

  /**
   * Search by colour: the user's pictures with the most of a colour (and
   * its lighter and darker shades) — or of a family's colours, "red" —
   * first.
   */
  byColour: picturesProcedure
    .input(
      z.object({
        colour: z.string().max(20),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(60).optional(),
      }),
    )
    .output(zPageOfPictures)
    .query(async ({ ctx, input }) => {
      const none = { bookmarks: [], nextCursor: null, total: 0 };
      // A family ("red") or a colour ("#286ff0").
      const query = parseColourQuery(input.colour);
      const { palettesEnabled } = await getPictureSettings(ctx.db, ctx.user.id);
      if (!query || !palettesEnabled) {
        return none;
      }
      const ranked = (
        await ctx.db
          .select({
            id: picturePalettesTable.bookmarkId,
            colours: picturePalettesTable.colours,
          })
          .from(picturePalettesTable)
          .where(eq(picturePalettesTable.userId, ctx.user.id))
      )
        .filter((row) => colourQueryMatches(row.colours ?? [], query))
        .map((row) => ({
          id: row.id,
          match: colourQueryScore(row.colours ?? [], query),
        }))
        .sort((a, b) => b.match - a.match)
        .slice(0, MAX_COLOUR_RESULTS);
      return pageOf(
        ctx,
        ranked.map((r) => r.id),
        input.cursor ?? 0,
        input.limit ?? PAGE,
      );
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
   * The search bar's one search: bookmarks by their words (titles, text,
   * URLs, tags — the search index), pictures by what's in them (their
   * fingerprints), by colour (color:red, #c8a27a) and, where the server has
   * text embeddings, by meaning — the search language's qualifiers (list:,
   * is:fav…) narrowing all of it. Each ranks on its own and they're merged
   * by rank, so what several find rises; newest or oldest first, it's all
   * of them by date. A new description's fingerprint can take the workers a
   * moment (the first time, the text model downloads): until it's there, the
   * rest answers, with `pictures: "preparing"`.
   */
  search: picturesProcedure
    .input(
      z.object({
        text: z.string().max(1000),
        sortOrder: zSortOrder.optional(),
        cursor: z.number().int().min(0).nullish(),
      }),
    )
    .output(
      zPageOfPictures.extend({
        pictures: z.enum(["on", "preparing", "off"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sortOrder = input.sortOrder ?? "relevance";
      const parsed = parseSearchQuery(input.text);
      const words = parsed.text.trim();
      const settings = await getPictureSettings(ctx.db, ctx.user.id);
      let pictures: "on" | "preparing" | "off" = settings.describeEnabled
        ? "on"
        : "off";
      const allowedIds = parsed.matcher
        ? await getBookmarkIdsFromMatcher(ctx, parsed.matcher)
        : null;
      const allowed = allowedIds ? new Set(allowedIds) : null;
      const colours = settings.palettesEnabled ? coloursIn(parsed.matcher) : [];

      let ranked: string[];
      if (allowedIds?.length === 0) {
        ranked = [];
      } else if (words) {
        const [wordHits, meaningHits, pictureHits, colourHits] =
          await Promise.all([
            byWords(ctx, words, allowedIds),
            byMeaning(ctx, words, allowedIds),
            settings.describeEnabled
              ? byDescription(ctx, words, allowed, settings.describeLevel)
              : [],
            byColours(ctx, colours, allowed),
          ]);
        if (pictureHits === null) {
          pictures = "preparing";
        }
        const found = [wordHits, meaningHits, pictureHits ?? []];
        // The words find; a colour only puts the most of it first.
        const foundIds = new Set(found.flat());
        const colourFirst = colourHits.filter((id) => foundIds.has(id));
        ranked =
          sortOrder === "relevance"
            ? reciprocalRankFusion(
                [...found, colourFirst].map((ids) => ids.map((id) => ({ id }))),
              ).map((hit) => hit.id)
            : await byDate(ctx, [...foundIds], sortOrder);
      } else {
        // Qualifiers only (is:fav, list:…): all they match, by date — for a
        // colour, the most of it first.
        const dated = await byDate(
          ctx,
          allowedIds,
          sortOrder === "asc" ? "asc" : "desc",
        );
        if (sortOrder === "relevance" && colours.length > 0) {
          const first = await byColours(ctx, colours, allowed);
          const firstIds = new Set(first);
          ranked = [...first, ...dated.filter((id) => !firstIds.has(id))];
        } else {
          ranked = dated;
        }
      }
      return {
        ...(await pageOf(ctx, ranked, input.cursor ?? 0, PAGE)),
        pictures,
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
