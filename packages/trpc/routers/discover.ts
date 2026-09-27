import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { bookmarkLists, discoverItemsTable } from "@karakeep/db/schema";
import {
  bufferToVector,
  pictureDistance,
  queueDiscoverKeep,
  requestDiscover,
} from "@karakeep/shared-server";
import { zDiscoverItemSchema } from "@karakeep/shared/types/pictures";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { List, ManualList } from "../models/lists";

/**
 * Fork: Discover — the pictures from Pinterest waiting for Keep or Skip (the
 * workers find them: apps/workers/workers/pictures/discoverWorker.ts), the
 * best first. Keep files one in a list, the suggested one unless another is
 * picked (the workers download it); Skip puts it away for good, and the
 * waiting ones that look like it with it.
 */

const discoverProcedure = createScopedAuthedProcedure("bookmarks");

/** A skipped one takes the waiting ones at least this alike with it. */
const SKIP_ALONG = 0.12;

async function ownItem(ctx: AuthedContext, itemId: string) {
  const item = await ctx.db.query.discoverItemsTable.findFirst({
    where: and(
      eq(discoverItemsTable.id, itemId),
      eq(discoverItemsTable.userId, ctx.user.id),
    ),
  });
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  }
  return item;
}

export const discoverAppRouter = router({
  /** Everything waiting (a couple of hundred at most), the best first. */
  items: discoverProcedure
    .output(z.object({ items: z.array(zDiscoverItemSchema) }))
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: discoverItemsTable.id,
          title: discoverItemsTable.title,
          thumbUrl: discoverItemsTable.thumbUrl,
          width: discoverItemsTable.width,
          height: discoverItemsTable.height,
          pinId: discoverItemsTable.pinId,
          status: discoverItemsTable.status,
          error: discoverItemsTable.error,
          listId: bookmarkLists.id,
          listName: bookmarkLists.name,
          listIcon: bookmarkLists.icon,
        })
        .from(discoverItemsTable)
        .leftJoin(
          bookmarkLists,
          eq(bookmarkLists.id, discoverItemsTable.suggestedListId),
        )
        .where(
          and(
            eq(discoverItemsTable.userId, ctx.user.id),
            eq(discoverItemsTable.status, "new"),
          ),
        )
        .orderBy(desc(discoverItemsTable.score), asc(discoverItemsTable.id));
      return {
        items: rows.map(({ pinId, listId, listName, listIcon, ...row }) => ({
          ...row,
          pinUrl: `https://www.pinterest.com/pin/${pinId}/`,
          suggestedList:
            listId && listName !== null
              ? { id: listId, name: listName, icon: listIcon ?? "" }
              : null,
        })),
      };
    }),

  /**
   * Keep: into `listId` — the suggested list when left out, no list when
   * null (it's just saved).
   */
  keep: discoverProcedure
    .input(z.object({ itemId: z.string(), listId: z.string().nullish() }))
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      const item = await ownItem(ctx, input.itemId);
      if (item.status !== "new") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "It's been kept or skipped already",
        });
      }
      const listId =
        input.listId === undefined ? item.suggestedListId : input.listId;
      if (listId) {
        const list = await List.fromId(ctx, listId);
        list.ensureCanEdit();
        if (!(list instanceof ManualList)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pictures go in a list of your own, not a smart list",
          });
        }
      }
      await ctx.db
        .update(discoverItemsTable)
        .set({ status: "keeping", listId: listId ?? null, error: null })
        .where(eq(discoverItemsTable.id, item.id));
      await queueDiscoverKeep(item.id, ctx.user.id);
    }),

  /** Skip: never offered again, nor the waiting ones that look like it. */
  skip: discoverProcedure
    .input(z.object({ itemId: z.string() }))
    .output(z.object({ alongWith: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ownItem(ctx, input.itemId);
      await ctx.db
        .update(discoverItemsTable)
        .set({ status: "skipped", decidedAt: new Date() })
        .where(eq(discoverItemsTable.id, item.id));
      if (!item.embedding) {
        return { alongWith: 0 };
      }
      const vector = bufferToVector(item.embedding);
      const alike = (
        await ctx.db
          .select({
            id: discoverItemsTable.id,
            embedding: discoverItemsTable.embedding,
          })
          .from(discoverItemsTable)
          .where(
            and(
              eq(discoverItemsTable.userId, ctx.user.id),
              eq(discoverItemsTable.status, "new"),
              isNotNull(discoverItemsTable.embedding),
            ),
          )
      )
        .filter(
          (row) =>
            pictureDistance(vector, bufferToVector(row.embedding!)) <=
            SKIP_ALONG,
        )
        .map((row) => row.id);
      // Gone rather than skipped: a later run leaves them out anyway, being
      // this like a skipped one.
      if (alike.length > 0) {
        await ctx.db
          .delete(discoverItemsTable)
          .where(inArray(discoverItemsTable.id, alike));
      }
      return { alongWith: alike.length };
    }),

  /** Undoes a Skip. */
  restore: discoverProcedure
    .input(z.object({ itemId: z.string() }))
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      const item = await ownItem(ctx, input.itemId);
      if (item.status === "skipped") {
        await ctx.db
          .update(discoverItemsTable)
          .set({ status: "new", decidedAt: null })
          .where(eq(discoverItemsTable.id, item.id));
      }
    }),

  /** "Look for more": a run now. */
  refresh: discoverProcedure.output(z.void()).mutation(async ({ ctx }) => {
    await requestDiscover(ctx.db, ctx.user.id);
  }),
});
