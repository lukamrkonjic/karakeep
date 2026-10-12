import { eq } from "drizzle-orm";

import { smartListLeftOutTable, users } from "@karakeep/db/schema";
import { parseUiPreferences } from "@karakeep/shared/types/uiPreferences";

import type { AuthedContext } from "../index";
import { getBookmarkIdsFromMatcher } from "./search";

/**
 * Fork: lists left out — of the colour pages (their "…" → Choose lists…,
 * one choice for the account: `colourLeftOutLists`) and of a smart list
 * (its own "…" → Choose lists…: smartListLeftOut). Picked as the tailored
 * feed's lists are; a left-out list takes everything under it with it.
 */

/** The lists the colour pages leave out. */
export async function colourLeftOutLists(ctx: AuthedContext) {
  const row = await ctx.db.query.users.findFirst({
    where: eq(users.id, ctx.user.id),
    columns: { uiPreferences: true },
  });
  return parseUiPreferences(row?.uiPreferences).colourLeftOutLists ?? [];
}

/** The bookmarks in these lists, or in a list under one of them. */
async function inLists(ctx: AuthedContext, listIds: string[]) {
  if (listIds.length === 0) {
    return new Set<string>();
  }
  const ids = await getBookmarkIdsFromMatcher(ctx, {
    type: "or",
    matchers: listIds.map((listId) => ({
      type: "listId" as const,
      listId,
      inverse: false,
    })),
  });
  return new Set(ids);
}

/** The bookmarks a colour page doesn't show. */
export async function leftOutOfColours(ctx: AuthedContext) {
  return inLists(ctx, await colourLeftOutLists(ctx));
}

/** The lists a smart list leaves out (none when it was never asked to). */
export async function smartListLeftOut(ctx: AuthedContext, listId: string) {
  const row = await ctx.db.query.smartListLeftOutTable.findFirst({
    where: eq(smartListLeftOutTable.listId, listId),
    columns: { lists: true },
  });
  return row?.lists ?? [];
}

/** A smart list's bookmarks without what the lists it leaves out hold. */
export async function withoutLeftOut(
  ctx: AuthedContext,
  listId: string,
  bookmarkIds: string[],
) {
  if (bookmarkIds.length === 0) {
    return bookmarkIds;
  }
  const leftOut = await smartListLeftOut(ctx, listId);
  if (leftOut.length === 0) {
    return bookmarkIds;
  }
  const out = await inLists(ctx, leftOut);
  return bookmarkIds.filter((id) => !out.has(id));
}
