import { eq } from "drizzle-orm";

import type { Matcher } from "@karakeep/shared/types/search";
import { users } from "@karakeep/db/schema";
import {
  asksForColour,
  colourLeftOutFor,
} from "@karakeep/shared/colourLeftOut";
import { parseUiPreferences } from "@karakeep/shared/types/uiPreferences";

import type { AuthedContext } from "../index";
import { getBookmarkIdsFromMatcher } from "./search";

/**
 * Fork: the lists left out of colours (packages/shared/colourLeftOut.ts),
 * as the account keeps them, and what they hold.
 */

/** The lists the user leaves out of colours. */
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

/**
 * A smart list's bookmarks without the lists left out of colours, when it
 * asks for a colour — but not those its own rules name.
 */
export async function withoutColourLeftOut(
  ctx: AuthedContext,
  matcher: Matcher,
  bookmarkIds: string[],
) {
  if (!asksForColour(matcher)) {
    return bookmarkIds;
  }
  const leftOut = colourLeftOutFor(matcher, await colourLeftOutLists(ctx));
  if (leftOut.length === 0) {
    return bookmarkIds;
  }
  const out = await inLists(ctx, leftOut);
  return bookmarkIds.filter((id) => !out.has(id));
}
