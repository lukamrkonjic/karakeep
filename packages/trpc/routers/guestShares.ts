import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import {
  bookmarkLists,
  guestShareListsTable,
  guestSharesTable,
} from "@karakeep/db/schema";
import {
  DEFAULT_NUM_BOOKMARKS_PER_PAGE,
  MAX_NUM_BOOKMARKS_PER_PAGE,
  zBookmarkSchema,
  zSortOrder,
} from "@karakeep/shared/types/bookmarks";
import {
  MAX_GUEST_SHARE_NAME_LENGTH,
  zGuestShareSchema,
  zGuestShareViewSchema,
  zUpdateGuestShareSchema,
} from "@karakeep/shared/types/guestShares";
import { zCursorV2 } from "@karakeep/shared/types/pagination";

import type { AuthedContext, Context } from "../index";
import type { GuestShareScope } from "../lib/guestShares";
import { publicProcedure, router, sessionProcedure } from "../index";
import {
  guestBookmarkIds,
  guestListSizes,
  guestListsOf,
  guestShareScope,
} from "../lib/guestShares";
import { buildImpersonatingAuthedContext } from "../lib/impersonate";
import { Bookmark } from "../models/bookmarks";
import { searchPictures } from "./pictures";

/**
 * Fork: guest links (Share with a guest…). The owner makes links and ticks
 * the lists each shows; whoever has a link looks through those lists — the
 * grid, search, the preview — without an account, and can't change a thing.
 * The guest's side answers by the link's token alone, as the owner but only
 * within the link's lists (lib/guestShares.ts); its files are served by
 * packages/api/routes/public/guestShares.ts.
 */

const DEFAULT_NAME = "Guest link";

function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

async function sharesOf(ctx: AuthedContext, shareId?: string) {
  const rows = await ctx.db
    .select()
    .from(guestSharesTable)
    .where(
      and(
        eq(guestSharesTable.userId, ctx.user.id),
        shareId ? eq(guestSharesTable.id, shareId) : undefined,
      ),
    )
    .orderBy(desc(guestSharesTable.createdAt));
  const lists =
    rows.length === 0
      ? []
      : await ctx.db
          .select()
          .from(guestShareListsTable)
          .where(
            inArray(
              guestShareListsTable.shareId,
              rows.map((r) => r.id),
            ),
          );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    token: r.token,
    showNotes: r.showNotes,
    listIds: lists.filter((l) => l.shareId === r.id).map((l) => l.listId),
    createdAt: r.createdAt,
  }));
}

async function ownShare(ctx: AuthedContext, shareId: string) {
  const [share] = await sharesOf(ctx, shareId);
  if (!share) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Link not found" });
  }
  return share;
}

/** These lists as a link's: only your own manual lists count. */
async function setLists(
  ctx: AuthedContext,
  shareId: string,
  listIds: string[],
) {
  const own =
    listIds.length === 0
      ? []
      : await ctx.db
          .select({ id: bookmarkLists.id })
          .from(bookmarkLists)
          .where(
            and(
              inArray(bookmarkLists.id, listIds),
              eq(bookmarkLists.userId, ctx.user.id),
              eq(bookmarkLists.type, "manual"),
            ),
          );
  ctx.db.transaction((tx) => {
    tx.delete(guestShareListsTable)
      .where(eq(guestShareListsTable.shareId, shareId))
      .run();
    if (own.length > 0) {
      tx.insert(guestShareListsTable)
        .values(own.map((l) => ({ shareId, listId: l.id })))
        .run();
    }
  });
}

/** The link this token is; a missing one is "not found", whatever else. */
async function scopeOf(ctx: Context, token: string) {
  const scope = await guestShareScope(ctx.db, token);
  if (!scope) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Link not found" });
  }
  return scope;
}

/** One of the link's lists, or all of them. */
function listsAsked(scope: GuestShareScope, listId: string | undefined) {
  if (listId === undefined) {
    return scope.listIds;
  }
  if (!scope.listIds.includes(listId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "List not found" });
  }
  return [listId];
}

/** A bookmark as the guest has it: nothing of yours they weren't given. */
function forGuest(scope: GuestShareScope, bookmark: ZBookmark): ZBookmark {
  return {
    ...bookmark,
    note: scope.showNotes ? bookmark.note : null,
    archived: false,
    favourited: false,
  };
}

const zToken = z.string().min(1).max(200);

export const guestSharesAppRouter = router({
  // The owner's side.
  list: sessionProcedure
    .output(z.array(zGuestShareSchema))
    .query(({ ctx }) => sharesOf(ctx)),
  create: sessionProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(MAX_GUEST_SHARE_NAME_LENGTH)
          .optional(),
        listIds: z.array(z.string()).max(2000).optional(),
      }),
    )
    .output(zGuestShareSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(guestSharesTable)
        .values({
          userId: ctx.user.id,
          token: newToken(),
          name: input.name ?? DEFAULT_NAME,
        })
        .returning();
      if (input.listIds?.length) {
        await setLists(ctx, row.id, input.listIds);
      }
      return ownShare(ctx, row.id);
    }),
  update: sessionProcedure
    .input(zUpdateGuestShareSchema)
    .output(zGuestShareSchema)
    .mutation(async ({ ctx, input }) => {
      const share = await ownShare(ctx, input.id);
      if (input.name !== undefined || input.showNotes !== undefined) {
        await ctx.db
          .update(guestSharesTable)
          .set({ name: input.name, showNotes: input.showNotes })
          .where(eq(guestSharesTable.id, share.id));
      }
      if (input.listIds) {
        await setLists(ctx, share.id, input.listIds);
      }
      return ownShare(ctx, share.id);
    }),
  /** A new address: the old one stops working. */
  resetLink: sessionProcedure
    .input(z.object({ id: z.string() }))
    .output(zGuestShareSchema)
    .mutation(async ({ ctx, input }) => {
      const share = await ownShare(ctx, input.id);
      await ctx.db
        .update(guestSharesTable)
        .set({ token: newToken() })
        .where(eq(guestSharesTable.id, share.id));
      return ownShare(ctx, share.id);
    }),
  delete: sessionProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(guestSharesTable)
        .where(
          and(
            eq(guestSharesTable.id, input.id),
            eq(guestSharesTable.userId, ctx.user.id),
          ),
        );
    }),

  // The guest's side: by the link's token, nothing else.
  view: publicProcedure
    .input(z.object({ token: zToken }))
    .output(zGuestShareViewSchema)
    .query(async ({ ctx, input }) => {
      const scope = await scopeOf(ctx, input.token);
      const [lists, sizes] = await Promise.all([
        scope.listIds.length === 0
          ? []
          : ctx.db
              .select({
                id: bookmarkLists.id,
                name: bookmarkLists.name,
                icon: bookmarkLists.icon,
                description: bookmarkLists.description,
                parentId: bookmarkLists.parentId,
              })
              .from(bookmarkLists)
              .where(inArray(bookmarkLists.id, scope.listIds))
              // The sidebar's order (lists are dragged into it).
              .orderBy(desc(bookmarkLists.position), bookmarkLists.name),
        guestListSizes(ctx.db, scope),
      ]);
      const shown = new Set(scope.listIds);
      return {
        ownerName: scope.ownerName,
        showNotes: scope.showNotes,
        lists: lists.map((l) => ({
          ...l,
          parentId: l.parentId && shown.has(l.parentId) ? l.parentId : null,
          numItems: sizes.perList.get(l.id) ?? 0,
        })),
        numItems: sizes.total,
      };
    }),
  bookmarks: publicProcedure
    .input(
      z.object({
        token: zToken,
        listId: z.string().optional(),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        cursor: zCursorV2.nullish(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_NUM_BOOKMARKS_PER_PAGE)
          .default(DEFAULT_NUM_BOOKMARKS_PER_PAGE),
      }),
    )
    .output(
      z.object({
        bookmarks: z.array(zBookmarkSchema),
        nextCursor: zCursorV2.nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await scopeOf(ctx, input.token);
      const listIds = listsAsked(scope, input.listId);
      if (listIds.length === 0) {
        return { bookmarks: [], nextCursor: null };
      }
      const owner = await buildImpersonatingAuthedContext(scope.userId, ctx.db);
      const page = await Bookmark.loadMulti(owner, {
        listIds,
        archived: scope.includeArchived ? undefined : false,
        includeContent: false,
        limit: input.limit,
        sortOrder: input.sortOrder,
        cursor: input.cursor,
      });
      return {
        bookmarks: page.bookmarks.map((b) => forGuest(scope, b.asZBookmark())),
        nextCursor: page.nextCursor,
      };
    }),
  /** The search bar's search (pictures.search), within the link's lists. */
  search: publicProcedure
    .input(
      z.object({
        token: zToken,
        text: z.string().max(1000),
        listId: z.string().optional(),
        sortOrder: zSortOrder.optional(),
        cursor: z.number().int().min(0).nullish(),
      }),
    )
    .output(
      z.object({
        bookmarks: z.array(zBookmarkSchema),
        nextCursor: z.number().nullable(),
        total: z.number(),
        pictures: z.enum(["on", "preparing", "off"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await scopeOf(ctx, input.token);
      const only = await guestBookmarkIds(
        ctx.db,
        scope,
        listsAsked(scope, input.listId),
      );
      const owner = await buildImpersonatingAuthedContext(scope.userId, ctx.db);
      const page = await searchPictures(
        owner,
        {
          text: input.text,
          sortOrder: input.sortOrder,
          cursor: input.cursor,
        },
        only,
      );
      return {
        ...page,
        bookmarks: page.bookmarks.map((b) => forGuest(scope, b)),
      };
    }),
  /** One bookmark (the preview, a link to one), and its lists among the link's. */
  bookmark: publicProcedure
    .input(z.object({ token: zToken, bookmarkId: z.string() }))
    .output(
      z.object({ bookmark: zBookmarkSchema, listIds: z.array(z.string()) }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await scopeOf(ctx, input.token);
      const listIds = await guestListsOf(ctx.db, scope, input.bookmarkId);
      if (listIds.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      const owner = await buildImpersonatingAuthedContext(scope.userId, ctx.db);
      const {
        bookmarks: [bookmark],
      } = await Bookmark.loadMulti(owner, {
        ids: [input.bookmarkId],
        includeContent: false,
        sortOrder: "desc",
      });
      if (!bookmark) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      return { bookmark: forGuest(scope, bookmark.asZBookmark()), listIds };
    }),
});
