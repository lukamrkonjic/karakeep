import { TRPCError } from "@trpc/server";
import { and, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import {
  assets,
  bookmarkAssets,
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  duplicatePicturesTable,
  pictureDuplicateScansTable,
  pictureEmbeddingsTable,
  tagsOnBookmarks,
} from "@karakeep/db/schema";
import {
  fingerprintProgress,
  queueDuplicatePicturesCheck,
  triggerSearchReindex,
} from "@karakeep/shared-server";
import type { ZDuplicatePicture } from "@karakeep/shared/types/duplicatePictures";
import {
  bestDuplicate,
  DUPLICATE_MATCH_LEVELS,
  zDuplicateGroupSchema,
  zDuplicateMatchLevelSchema,
  zDuplicatePicturesStatusSchema,
} from "@karakeep/shared/types/duplicatePictures";
import { groupDuplicatePairs } from "@karakeep/shared/utils/duplicateGroups";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { Bookmark } from "../models/bookmarks";
import { List, ManualList } from "../models/lists";

/**
 * Fork: Cleanups → Duplicate pictures. The workers find alike pictures every
 * night (apps/workers/workers/duplicatesWorker.ts); here the user sees them
 * grouped and keeps one — which takes the others' lists, tags and favourite
 * before they are deleted — or keeps them all.
 */

const duplicatesProcedure = createScopedAuthedProcedure("bookmarks");

/** Groups shown at once; resolving some brings up the next. */
const GROUPS_SHOWN = 50;

function chunks<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** The open pairs at this level, grouped. */
async function openGroups(ctx: AuthedContext, maxDistance: number) {
  const pairs = await ctx.db
    .select({
      a: duplicatePicturesTable.bookmarkId,
      b: duplicatePicturesTable.otherBookmarkId,
      distance: duplicatePicturesTable.distance,
    })
    .from(duplicatePicturesTable)
    .where(
      and(
        eq(duplicatePicturesTable.userId, ctx.user.id),
        eq(duplicatePicturesTable.status, "open"),
        lte(duplicatePicturesTable.distance, maxDistance),
      ),
    );
  return groupDuplicatePairs(pairs);
}

/** What the page shows of each picture. */
async function pictureDetails(
  ctx: AuthedContext,
  ids: string[],
): Promise<Map<string, ZDuplicatePicture>> {
  const details = new Map<string, ZDuplicatePicture>();
  for (const chunk of chunks(ids)) {
    const rows = await ctx.db
      .select({
        bookmarkId: bookmarks.id,
        title: bookmarks.title,
        createdAt: bookmarks.createdAt,
        favourited: bookmarks.favourited,
        archived: bookmarks.archived,
        kind: bookmarkAssets.assetType,
        assetId: bookmarkAssets.assetId,
        sourceUrl: bookmarkAssets.sourceUrl,
        // For a video: the first frame the model looked at.
        lookedAt: pictureEmbeddingsTable.assetId,
        width: pictureEmbeddingsTable.width,
        height: pictureEmbeddingsTable.height,
        size: assets.size,
        contentType: assets.contentType,
      })
      .from(bookmarks)
      .innerJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
      .leftJoin(
        pictureEmbeddingsTable,
        eq(pictureEmbeddingsTable.bookmarkId, bookmarks.id),
      )
      .leftJoin(assets, eq(assets.id, bookmarkAssets.assetId))
      .where(
        and(eq(bookmarks.userId, ctx.user.id), inArray(bookmarks.id, chunk)),
      );
    const lists = await ctx.db
      .select({
        bookmarkId: bookmarksInLists.bookmarkId,
        id: bookmarkLists.id,
        name: bookmarkLists.name,
        icon: bookmarkLists.icon,
      })
      .from(bookmarksInLists)
      .innerJoin(bookmarkLists, eq(bookmarkLists.id, bookmarksInLists.listId))
      .where(inArray(bookmarksInLists.bookmarkId, chunk));
    for (const row of rows) {
      if (row.kind !== "image" && row.kind !== "video") {
        continue;
      }
      details.set(row.bookmarkId, {
        bookmarkId: row.bookmarkId,
        title: row.title,
        createdAt: row.createdAt,
        favourited: row.favourited,
        archived: row.archived,
        kind: row.kind,
        imageAssetId:
          row.kind === "video" ? (row.lookedAt ?? row.assetId) : row.assetId,
        contentType: row.contentType,
        size: row.size ?? 0,
        width: row.width,
        height: row.height,
        sourceUrl: row.sourceUrl,
        lists: lists
          .filter((l) => l.bookmarkId === row.bookmarkId)
          .map(({ id, name, icon }) => ({ id, name, icon })),
      });
    }
  }
  return details;
}

/** Groups with their pictures, newest first; a group needs two to show. */
async function detailedGroups(ctx: AuthedContext, maxDistance: number) {
  const groups = await openGroups(ctx, maxDistance);
  const details = await pictureDetails(
    ctx,
    groups.flatMap((g) => g.ids),
  );
  return groups
    .map((group) => ({
      distance: group.distance,
      pictures: group.ids
        .flatMap((id) => details.get(id) ?? [])
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    }))
    .filter((group) => group.pictures.length >= 2)
    .sort(
      (a, b) =>
        b.pictures[b.pictures.length - 1].createdAt.getTime() -
        a.pictures[a.pictures.length - 1].createdAt.getTime(),
    );
}

/**
 * Keeps one bookmark of a group: it joins every list the others are in and
 * takes their tags, and a favourite among them; then the others are deleted.
 */
async function keepOne(
  ctx: AuthedContext,
  keepId: string,
  otherIds: string[],
): Promise<void> {
  const rows = await ctx.db.query.bookmarks.findMany({
    where: and(
      eq(bookmarks.userId, ctx.user.id),
      inArray(bookmarks.id, [keepId, ...otherIds]),
    ),
    columns: {
      id: true,
      title: true,
      note: true,
      favourited: true,
      archived: true,
    },
  });
  const keep = rows.find((r) => r.id === keepId);
  const others = rows.filter((r) => r.id !== keepId);
  if (!keep || others.length !== otherIds.length) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Some of these pictures are gone. Reload the page.",
    });
  }

  const listIds = new Set(
    (
      await ctx.db
        .select({ listId: bookmarksInLists.listId })
        .from(bookmarksInLists)
        .where(inArray(bookmarksInLists.bookmarkId, otherIds))
    ).map((r) => r.listId),
  );
  for (const listId of listIds) {
    const list = await List.fromId(ctx, listId).catch(() => null);
    if (list instanceof ManualList) {
      // A shared list this user may only view keeps the copy's absence.
      await list.addBookmark(keepId).catch(() => undefined);
    }
  }

  const tags = await ctx.db
    .select({
      tagId: tagsOnBookmarks.tagId,
      attachedBy: tagsOnBookmarks.attachedBy,
    })
    .from(tagsOnBookmarks)
    .where(inArray(tagsOnBookmarks.bookmarkId, otherIds));
  if (tags.length > 0) {
    await ctx.db
      .insert(tagsOnBookmarks)
      .values(tags.map((t) => ({ ...t, bookmarkId: keepId })))
      .onConflictDoNothing();
  }

  await ctx.db
    .update(bookmarks)
    .set({
      favourited: keep.favourited || others.some((o) => o.favourited),
      // Still in view if any copy was.
      archived: keep.archived && others.every((o) => o.archived),
      title: keep.title || others.find((o) => o.title)?.title || null,
      note: keep.note || others.find((o) => o.note)?.note || null,
      modifiedAt: new Date(),
    })
    .where(eq(bookmarks.id, keepId));
  await triggerSearchReindex(keepId, { groupId: ctx.user.id });

  for (const id of otherIds) {
    await (await Bookmark.fromId(ctx, id, false)).delete();
  }
}

const zPictureIds = z.array(z.string()).min(2).max(200);

export const duplicatePicturesAppRouter = router({
  status: duplicatesProcedure
    .output(zDuplicatePicturesStatusSchema)
    .query(async ({ ctx }) => {
      const scan = await ctx.db.query.pictureDuplicateScansTable.findFirst({
        where: eq(pictureDuplicateScansTable.userId, ctx.user.id),
      });
      // The pictures the fingerprints job works through (shared-server's
      // pictureSources.ts), and how many it has looked at.
      const { done, unreadable, total } = await fingerprintProgress(
        ctx.db,
        ctx.user.id,
      );
      return {
        status: scan?.status ?? "never",
        checkedAt: scan?.checkedAt ?? null,
        error: scan?.error ?? null,
        checked: done + unreadable,
        total,
      };
    }),

  list: duplicatesProcedure
    .input(z.object({ level: zDuplicateMatchLevelSchema }))
    .output(
      z.object({ groups: z.array(zDuplicateGroupSchema), total: z.number() }),
    )
    .query(async ({ ctx, input }) => {
      const groups = await detailedGroups(
        ctx,
        DUPLICATE_MATCH_LEVELS[input.level],
      );
      return { groups: groups.slice(0, GROUPS_SHOWN), total: groups.length };
    }),

  /** Looks for duplicates now instead of tonight. */
  check: duplicatesProcedure.output(z.void()).mutation(async ({ ctx }) => {
    await queueDuplicatePicturesCheck(ctx.db, ctx.user.id);
  }),

  keep: duplicatesProcedure
    .input(z.object({ keepBookmarkId: z.string(), bookmarkIds: zPictureIds }))
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      await keepOne(
        ctx,
        input.keepBookmarkId,
        input.bookmarkIds.filter((id) => id !== input.keepBookmarkId),
      );
    }),

  /** Not duplicates: never offered again (at any level). */
  keepAll: duplicatesProcedure
    .input(z.object({ bookmarkIds: zPictureIds }))
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(duplicatePicturesTable)
        .set({ status: "kept" })
        .where(
          and(
            eq(duplicatePicturesTable.userId, ctx.user.id),
            inArray(duplicatePicturesTable.bookmarkId, input.bookmarkIds),
            inArray(duplicatePicturesTable.otherBookmarkId, input.bookmarkIds),
          ),
        );
    }),

  /** Every group at this level keeps its largest picture. */
  keepBest: duplicatesProcedure
    .input(z.object({ level: zDuplicateMatchLevelSchema }))
    .output(z.object({ groups: z.number(), deleted: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const groups = await detailedGroups(
        ctx,
        DUPLICATE_MATCH_LEVELS[input.level],
      );
      let deleted = 0;
      for (const group of groups) {
        const best = bestDuplicate(group.pictures);
        const others = group.pictures
          .map((p) => p.bookmarkId)
          .filter((id) => id !== best.bookmarkId);
        await keepOne(ctx, best.bookmarkId, others);
        deleted += others.length;
      }
      return { groups: groups.length, deleted };
    }),
});
