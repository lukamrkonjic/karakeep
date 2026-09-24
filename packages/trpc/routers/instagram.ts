import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { instagramSessionsTable } from "@karakeep/db/schema";
import {
  checkInstagramSession,
  INSTAGRAM_SESSION_PURPOSE,
  InstagramRequestError,
  InstagramSessionError,
  sealSecret,
} from "@karakeep/shared-server";
import { zInstagramConnectionSchema } from "@karakeep/shared/types/listSubscriptions";
import { parseInstagramSession } from "@karakeep/shared/utils/instagram";

import { createScopedAuthedProcedure, router } from "../index";

/**
 * Fork: connecting Instagram, so list subscriptions can read your saved
 * collections. Instagram has no API for them, so it's your browser session
 * (the `sessionid` cookie) that you paste in; it is checked against Instagram
 * on the spot, then kept sealed (see instagramSessionsTable). It never comes
 * back out through the API.
 */

const instagramProcedure = createScopedAuthedProcedure("lists");

export const instagramAppRouter = router({
  status: instagramProcedure
    .output(zInstagramConnectionSchema)
    .query(async ({ ctx }) => {
      const row = await ctx.db.query.instagramSessionsTable.findFirst({
        where: eq(instagramSessionsTable.userId, ctx.user.id),
        columns: { username: true, status: true, checkedAt: true },
      });
      return row
        ? { connected: true, ...row }
        : { connected: false, username: null, status: null, checkedAt: null };
    }),

  connect: instagramProcedure
    .input(z.object({ session: z.string().min(1).max(5000) }))
    .output(zInstagramConnectionSchema)
    .mutation(async ({ input, ctx }) => {
      const cookies = parseInstagramSession(input.session);
      if (!cookies) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That doesn't look like an Instagram session. Copy the value of the sessionid cookie (it starts with a number and a colon, or %3A).",
        });
      }
      let checked;
      try {
        checked = await checkInstagramSession(cookies, {
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof InstagramSessionError ||
            error instanceof InstagramRequestError
              ? error.message
              : `Couldn't reach Instagram: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      const row = {
        session: sealSecret(JSON.stringify(cookies), INSTAGRAM_SESSION_PURPOSE),
        instagramUserId: checked.instagramUserId,
        username: checked.username,
        status: "ok" as const,
        checkedAt: new Date(),
      };
      await ctx.db
        .insert(instagramSessionsTable)
        .values({ userId: ctx.user.id, ...row })
        .onConflictDoUpdate({
          target: instagramSessionsTable.userId,
          set: row,
        });
      return {
        connected: true,
        username: row.username,
        status: row.status,
        checkedAt: row.checkedAt,
      };
    }),

  /** Forgets the session. Subscriptions stay, and wait for a new one. */
  disconnect: instagramProcedure.output(z.void()).mutation(async ({ ctx }) => {
    await ctx.db
      .delete(instagramSessionsTable)
      .where(eq(instagramSessionsTable.userId, ctx.user.id));
  }),
});
