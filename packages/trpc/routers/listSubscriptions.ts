import { experimental_trpcMiddleware, TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { bookmarkLists, listSubscriptionsTable } from "@karakeep/db/schema";
import { queueSubscriptionSync } from "@karakeep/shared-server";
import {
  zListSubscriptionSchema,
  zNewListSubscriptionSchema,
  zUpdateListSubscriptionSchema,
} from "@karakeep/shared/types/listSubscriptions";
import { parsePinterestBoardUrl } from "@karakeep/shared/utils/pinterest";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { List } from "../models/lists";

/**
 * Fork: subscriptions that keep a list in sync with a source (for now, a
 * public Pinterest board). The worker does the fetching — see
 * apps/workers/workers/subscriptionWorker.ts.
 */

const subscriptionsProcedure = createScopedAuthedProcedure("lists");

/** The list must be one you can edit: a subscription writes into it. */
async function ensureListEditable(ctx: AuthedContext, listId: string) {
  const list = await List.fromId(ctx, listId);
  // Throws unless you may write to it, and says so in the same words the
  // rest of the app uses.
  list.ensureCanEdit();
  return list;
}

const ensureSubscriptionOwnership = experimental_trpcMiddleware<{
  ctx: AuthedContext;
  input: { subscriptionId: string };
}>().create(async (opts) => {
  const subscription = await opts.ctx.db.query.listSubscriptionsTable.findFirst(
    {
      where: and(
        eq(listSubscriptionsTable.id, opts.input.subscriptionId),
        eq(listSubscriptionsTable.userId, opts.ctx.user.id),
      ),
    },
  );
  if (!subscription) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Subscription not found",
    });
  }
  return opts.next({ ctx: { ...opts.ctx, subscription } });
});

export const listSubscriptionsAppRouter = router({
  list: subscriptionsProcedure
    .input(z.object({ listId: z.string() }))
    .output(z.object({ subscriptions: z.array(zListSubscriptionSchema) }))
    .query(async ({ input, ctx }) => {
      await List.fromId(ctx, input.listId); // throws unless you can see it
      const subscriptions = await ctx.db.query.listSubscriptionsTable.findMany({
        where: and(
          eq(listSubscriptionsTable.listId, input.listId),
          eq(listSubscriptionsTable.userId, ctx.user.id),
        ),
      });
      return { subscriptions };
    }),

  /** Every subscription you have, with the list each one feeds. */
  listAll: subscriptionsProcedure
    .output(
      z.object({
        subscriptions: z.array(
          zListSubscriptionSchema.extend({ listName: z.string() }),
        ),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(listSubscriptionsTable)
        .innerJoin(
          bookmarkLists,
          eq(bookmarkLists.id, listSubscriptionsTable.listId),
        )
        .where(eq(listSubscriptionsTable.userId, ctx.user.id));
      return {
        subscriptions: rows.map((row) => ({
          ...row.listSubscriptions,
          listName: row.bookmarkLists.name,
        })),
      };
    }),

  create: subscriptionsProcedure
    .input(zNewListSubscriptionSchema)
    .output(zListSubscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      await ensureListEditable(ctx, input.listId);
      const board = parsePinterestBoardUrl(input.url);
      if (!board) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That isn't a Pinterest board link. Use one like https://www.pinterest.com/<user>/<board>/ (board sections aren't supported yet).",
        });
      }
      // Store it in the shape the connector fetches, so the same board added
      // from two different Pinterest domains counts as one subscription.
      const url = `https://www.pinterest.com${board.path}`;
      const existing = await ctx.db.query.listSubscriptionsTable.findFirst({
        where: and(
          eq(listSubscriptionsTable.listId, input.listId),
          eq(listSubscriptionsTable.url, url),
        ),
      });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This list already subscribes to that board",
        });
      }
      const [subscription] = await ctx.db
        .insert(listSubscriptionsTable)
        .values({
          listId: input.listId,
          userId: ctx.user.id,
          kind: "pinterest",
          url,
          name: board.slug,
        })
        .returning();
      // Fetch it straight away; the schedule takes over afterwards.
      await queueSubscriptionSync(ctx.db, subscription);
      return { ...subscription, lastStatus: "pending" as const };
    }),

  update: subscriptionsProcedure
    .input(zUpdateListSubscriptionSchema)
    .output(zListSubscriptionSchema)
    .use(ensureSubscriptionOwnership)
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(listSubscriptionsTable)
        .set({ enabled: input.enabled })
        .where(eq(listSubscriptionsTable.id, input.subscriptionId))
        .returning();
      if (input.enabled && !ctx.subscription.enabled) {
        // Resuming catches up on what was pinned while it was paused.
        await queueSubscriptionSync(ctx.db, updated);
        return { ...updated, lastStatus: "pending" as const };
      }
      return updated;
    }),

  delete: subscriptionsProcedure
    .input(z.object({ subscriptionId: z.string() }))
    .output(z.void())
    .use(ensureSubscriptionOwnership)
    .mutation(async ({ input, ctx }) => {
      // The pictures stay, and so does the record of what was taken: adding
      // the board again won't download it all a second time.
      await ctx.db
        .delete(listSubscriptionsTable)
        .where(eq(listSubscriptionsTable.id, input.subscriptionId));
    }),

  /** "Sync now": every enabled subscription of a list, right away. */
  runNow: subscriptionsProcedure
    .input(z.object({ listId: z.string() }))
    .output(z.object({ queued: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureListEditable(ctx, input.listId);
      const subscriptions = await ctx.db.query.listSubscriptionsTable.findMany({
        where: and(
          eq(listSubscriptionsTable.listId, input.listId),
          eq(listSubscriptionsTable.userId, ctx.user.id),
          eq(listSubscriptionsTable.enabled, true),
        ),
        columns: { id: true, userId: true },
      });
      for (const subscription of subscriptions) {
        await queueSubscriptionSync(ctx.db, subscription);
      }
      return { queued: subscriptions.length };
    }),
});
