import { experimental_trpcMiddleware, TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  bookmarkLists,
  instagramSessionsTable,
  listSubscriptionsTable,
} from "@karakeep/db/schema";
import { queueSubscriptionSync } from "@karakeep/shared-server";
import {
  zListSubscriptionSchema,
  zNewListSubscriptionSchema,
  zUpdateListSubscriptionSchema,
} from "@karakeep/shared/types/listSubscriptions";
import {
  instagramCollectionName,
  instagramCollectionUrl,
  parseInstagramCollectionUrl,
} from "@karakeep/shared/utils/instagram";
import { parsePinterestBoardUrl } from "@karakeep/shared/utils/pinterest";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { List } from "../models/lists";

/**
 * Fork: subscriptions that keep a list in sync with a source — a public
 * Pinterest board, or one of your Instagram saved collections (which needs
 * Instagram connected, see routers/instagram.ts). The worker does the
 * fetching — see apps/workers/workers/subscriptionWorker.ts.
 */

/** A pasted link, as the source it is and the one form it's stored in. */
async function sourceOf(ctx: AuthedContext, raw: string) {
  const board = parsePinterestBoardUrl(raw);
  if (board) {
    // Any Pinterest domain: the same board is one subscription.
    return {
      kind: "pinterest" as const,
      url: `https://www.pinterest.com${board.path}`,
      name: board.slug,
    };
  }
  const collection = parseInstagramCollectionUrl(raw);
  if (collection) {
    const session = await ctx.db.query.instagramSessionsTable.findFirst({
      where: eq(instagramSessionsTable.userId, ctx.user.id),
      columns: { status: true },
    });
    if (!session || session.status !== "ok") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: session
          ? "Your Instagram session has expired. Paste a fresh one in Settings → List subscriptions, then add the collection."
          : "Connect Instagram first: Settings → List subscriptions → Instagram.",
      });
    }
    return {
      kind: "instagram" as const,
      url: instagramCollectionUrl(collection),
      name: instagramCollectionName(collection),
    };
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      "That isn't a Pinterest board or an Instagram collection link. Use one like https://www.pinterest.com/<user>/<board>/ or https://www.instagram.com/<you>/saved/<collection>/<id>/.",
  });
}

const subscriptionsProcedure = createScopedAuthedProcedure("lists");

/** A subscription as the API shows it. */
function toApi({
  wholeCarouselSince,
  ...subscription
}: typeof listSubscriptionsTable.$inferSelect) {
  return { ...subscription, wholeCarousel: wholeCarouselSince !== null };
}

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
      return { subscriptions: subscriptions.map(toApi) };
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
          ...toApi(row.listSubscriptions),
          listName: row.bookmarkLists.name,
        })),
      };
    }),

  create: subscriptionsProcedure
    .input(zNewListSubscriptionSchema)
    .output(zListSubscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      await ensureListEditable(ctx, input.listId);
      // Stored in the shape the connector fetches, so the same source linked
      // two ways counts as one subscription.
      const { kind, url, name } = await sourceOf(ctx, input.url);
      const existing = await ctx.db.query.listSubscriptionsTable.findFirst({
        where: and(
          eq(listSubscriptionsTable.listId, input.listId),
          eq(listSubscriptionsTable.url, url),
        ),
      });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This list already subscribes to that ${kind === "instagram" ? "collection" : "board"}`,
        });
      }
      const [subscription] = await ctx.db
        .insert(listSubscriptionsTable)
        .values({
          listId: input.listId,
          userId: ctx.user.id,
          kind,
          url,
          name,
          wholeCarouselSince: input.wholeCarousel ? new Date() : null,
        })
        .returning();
      // Fetch it straight away; the schedule takes over afterwards.
      await queueSubscriptionSync(ctx.db, subscription);
      return { ...toApi(subscription), lastStatus: "pending" as const };
    }),

  update: subscriptionsProcedure
    .input(zUpdateListSubscriptionSchema)
    .output(zListSubscriptionSchema)
    .use(ensureSubscriptionOwnership)
    .mutation(async ({ input, ctx }) => {
      const changes: Partial<typeof listSubscriptionsTable.$inferInsert> = {};
      if (input.enabled !== undefined) {
        changes.enabled = input.enabled;
      }
      if (input.wholeCarousel !== undefined) {
        // It counts from when it was turned on: posts taken before that keep
        // what they have instead of their other pictures turning up now, out
        // of place at the top of the list.
        changes.wholeCarouselSince = input.wholeCarousel
          ? (ctx.subscription.wholeCarouselSince ?? new Date())
          : null;
      }
      if (Object.keys(changes).length === 0) {
        return toApi(ctx.subscription);
      }
      const [updated] = await ctx.db
        .update(listSubscriptionsTable)
        .set(changes)
        .where(eq(listSubscriptionsTable.id, input.subscriptionId))
        .returning();
      if (input.enabled && !ctx.subscription.enabled) {
        // Resuming catches up on what was pinned while it was paused.
        await queueSubscriptionSync(ctx.db, updated);
        return { ...toApi(updated), lastStatus: "pending" as const };
      }
      return toApi(updated);
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
