import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Matcher } from "@karakeep/shared/types/search";
import type { ZSmartListRules } from "@karakeep/shared/types/smartLists";
import { smartListRulesTable } from "@karakeep/db/schema";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";
import {
  compileSmartRules,
  smartRulesFor,
} from "@karakeep/shared/smartListRules";
import {
  zBookmarkListSchema,
  zNewBookmarkListSchema,
} from "@karakeep/shared/types/lists";
import {
  zEditSmartListSchema,
  zNewSmartListSchema,
  zSmartListRulesSchema,
} from "@karakeep/shared/types/smartLists";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { prepareDescription } from "../lib/pictureText";
import { getBookmarkIdsFromMatcher } from "../lib/search";
import { List } from "../models/lists";
import { ensureListAtLeastOwner, ensureListAtLeastViewer } from "./lists";

/**
 * Fork: smart lists made of rules, like Eagle's smart folders — the rule
 * editor's side (apps/web/components/dashboard/lists/smart/). The rules
 * become the list's query (packages/shared/smartListRules.ts), so the list
 * is an ordinary smart list everywhere else; they're kept too
 * (smartListRules), so the editor opens them as they were made.
 */

const smartListsProcedure = createScopedAuthedProcedure("lists");

/** How long the editor's count waits for a new "Picture shows" description. */
const PREVIEW_DESCRIBE_WAIT_MS = 4000;

/** The rules as the list's query; every rule has to be complete. */
function queryOf(rules: ZSmartListRules): string {
  const { query, incomplete } = compileSmartRules(rules);
  if (!query || incomplete.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Every rule needs a value",
    });
  }
  return query;
}

async function saveRules(
  ctx: AuthedContext,
  listId: string,
  rules: ZSmartListRules,
) {
  const updatedAt = new Date();
  await ctx.db
    .insert(smartListRulesTable)
    .values({ listId, userId: ctx.user.id, rules, updatedAt })
    .onConflictDoUpdate({
      target: smartListRulesTable.listId,
      set: { rules, updatedAt },
    });
}

/** The descriptions a matcher asks the picture model about. */
function descriptionsIn(matcher: Matcher): string[] {
  switch (matcher.type) {
    case "shows":
      return [matcher.description];
    case "and":
    case "or":
      return matcher.matchers.flatMap(descriptionsIn);
    default:
      return [];
  }
}

export const smartListsAppRouter = router({
  /** A smart list's rules, as its editor shows them. */
  rules: smartListsProcedure
    .input(z.object({ listId: z.string() }))
    .output(z.object({ rules: zSmartListRulesSchema }))
    .use(ensureListAtLeastViewer)
    .query(async ({ ctx, input }) => {
      const list = ctx.list.asZBookmarkList();
      if (list.type !== "smart" || !list.query) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a smart list",
        });
      }
      const stored = await ctx.db.query.smartListRulesTable.findFirst({
        where: eq(smartListRulesTable.listId, input.listId),
      });
      return { rules: smartRulesFor(list.query, stored?.rules) };
    }),

  /**
   * How many bookmarks the rules find (those complete so far), as the
   * sidebar will count them. `preparing` while a new "Picture shows"
   * description is still being read by the workers — ask again.
   */
  preview: smartListsProcedure
    .input(z.object({ rules: zSmartListRulesSchema }))
    .output(z.object({ count: z.number(), preparing: z.boolean() }))
    .query(async ({ ctx, input }) => {
      const { query } = compileSmartRules(input.rules);
      const matcher = query ? parseSearchQuery(query).matcher : undefined;
      if (!matcher) {
        return { count: 0, preparing: false };
      }
      const ready = await Promise.all(
        descriptionsIn(matcher).map((d) =>
          prepareDescription(ctx, d, PREVIEW_DESCRIBE_WAIT_MS),
        ),
      );
      const ids = await getBookmarkIdsFromMatcher(ctx, matcher);
      return { count: ids.length, preparing: ready.includes(false) };
    }),

  create: smartListsProcedure
    .input(zNewSmartListSchema)
    .output(zBookmarkListSchema)
    .mutation(async ({ ctx, input }) => {
      // Upstream's own checks on a smart list's query, too.
      const list = await List.create(
        ctx,
        zNewBookmarkListSchema.parse({
          name: input.name,
          description: input.description,
          icon: input.icon,
          parentId: input.parentId,
          type: "smart",
          query: queryOf(input.rules),
        }),
      );
      await saveRules(ctx, list.id, input.rules);
      return list.asZBookmarkList();
    }),

  update: smartListsProcedure
    .input(zEditSmartListSchema)
    .output(zBookmarkListSchema)
    .use(ensureListAtLeastViewer)
    .use(ensureListAtLeastOwner)
    .mutation(async ({ ctx, input }) => {
      if (ctx.list.type !== "smart") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a smart list",
        });
      }
      await ctx.list.update({
        listId: input.listId,
        name: input.name,
        icon: input.icon,
        description: input.description,
        query: input.rules ? queryOf(input.rules) : undefined,
      });
      if (input.rules) {
        await saveRules(ctx, input.listId, input.rules);
      }
      return ctx.list.asZBookmarkList();
    }),
});
