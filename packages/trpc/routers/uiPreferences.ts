import { eq } from "drizzle-orm";

import { users } from "@karakeep/db/schema";
import {
  parseUiPreferences,
  zUiPreferencesSchema,
} from "@karakeep/shared/types/uiPreferences";

import { createScopedAuthedProcedure, router } from "../index";

/**
 * Fork: the web app's per-account UI preferences (see
 * packages/shared/types/uiPreferences.ts). `update` merges: only the keys it
 * is given change, so two devices changing different things don't undo each
 * other.
 */

const preferencesProcedure = createScopedAuthedProcedure("users");

export const uiPreferencesAppRouter = router({
  get: preferencesProcedure
    .output(zUiPreferencesSchema)
    .query(async ({ ctx }) => {
      const row = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
        columns: { uiPreferences: true },
      });
      return parseUiPreferences(row?.uiPreferences);
    }),

  update: preferencesProcedure
    .input(zUiPreferencesSchema)
    .output(zUiPreferencesSchema)
    .mutation(({ input, ctx }) => {
      // Read and write in one transaction, so quick successive changes
      // (ticking lists in the feed picker) can't lose each other.
      return ctx.db.transaction((tx) => {
        const row = tx
          .select({ uiPreferences: users.uiPreferences })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .get();
        const changes = Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        );
        const next = { ...parseUiPreferences(row?.uiPreferences), ...changes };
        tx.update(users)
          .set({ uiPreferences: JSON.stringify(next) })
          .where(eq(users.id, ctx.user.id))
          .run();
        return next;
      });
    }),
});
