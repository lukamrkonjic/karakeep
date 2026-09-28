import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { pictureTextQueriesTable } from "@karakeep/db/schema";
import {
  bufferToVector,
  getPictureSettings,
  normalizeDescription,
  pictureTextQueryId,
  PictureTextQueue,
  rankPictures,
} from "@karakeep/shared-server";
import { DESCRIBE_LEVELS } from "@karakeep/shared/types/pictures";

import type { AuthedContext } from "../index";
import { userPictureIndex } from "./pictureIndex";

/**
 * Fork: descriptions of what's in a picture — search by description
 * (routers/pictures.ts) and a smart list's "Picture shows" rule (the
 * `shows:` matcher, lib/search.ts). The workers make a description's
 * fingerprint with the picture model's text half; it's kept in
 * pictureTextQueries, the most recently used ones.
 */

/** How long a search waits for its description's fingerprint. */
export const DESCRIBE_WAIT_MS = 8000;
/** A description's use is stamped at most this often (stamping is a write). */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

/**
 * A description's fingerprint: from the cache, or asked of the workers and
 * waited for a while. Null while the workers are on it (the first search
 * loads the text model — downloads it, the very first time).
 */
export async function describedVector(
  ctx: AuthedContext,
  description: string,
  waitMs = DESCRIBE_WAIT_MS,
): Promise<Float32Array | null> {
  const id = pictureTextQueryId(description);
  const find = () =>
    ctx.db.query.pictureTextQueriesTable.findFirst({
      where: eq(pictureTextQueriesTable.id, id),
    });
  let row = await find();
  if (row?.embedding) {
    // Kept among the recently used (a smart list asks on every count).
    if (Date.now() - row.usedAt.getTime() > TOUCH_EVERY_MS) {
      await ctx.db
        .update(pictureTextQueriesTable)
        .set({ usedAt: new Date() })
        .where(eq(pictureTextQueriesTable.id, id));
    }
    return bufferToVector(row.embedding);
  }
  if (row?.error) {
    // Tried again after a minute.
    if (Date.now() - row.usedAt.getTime() < 60_000) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Couldn't search by description: ${row.error}`,
      });
    }
    await ctx.db
      .update(pictureTextQueriesTable)
      .set({ error: null, usedAt: new Date() })
      .where(eq(pictureTextQueriesTable.id, id));
  } else if (!row) {
    await ctx.db
      .insert(pictureTextQueriesTable)
      .values({ id, text: description })
      .onConflictDoNothing();
  }
  await PictureTextQueue.enqueue(
    { queryId: id },
    { idempotencyKey: `picture-text:${id}` },
  );
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 150));
    row = await find();
    if (row?.embedding) {
      return bufferToVector(row.embedding);
    }
    if (row?.error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Couldn't search by description: ${row.error}`,
      });
    }
  }
  return null;
}

/**
 * The user's pictures (and videos, by a frame) that show what the words
 * describe — all of them, as matched as the user's "Search by description"
 * level asks. Null while the description's fingerprint is being made.
 */
export async function picturesShowing(
  ctx: AuthedContext,
  words: string,
  waitMs: number,
): Promise<string[] | null> {
  const description = normalizeDescription(words);
  if (!description) {
    return [];
  }
  const vector = await describedVector(ctx, description, waitMs);
  if (!vector) {
    return null;
  }
  const { describeLevel } = await getPictureSettings(ctx.db, ctx.user.id);
  const loaded = await userPictureIndex(ctx.db, ctx.user.id);
  return rankPictures(loaded.index, vector, {
    minSimilarity: DESCRIBE_LEVELS[describeLevel],
  }).map((r) => r.id);
}

/**
 * Asks for a description's fingerprint and waits for it a while: false
 * while the workers are still making it (the smart list editor's count says
 * it's still looking). A description that can't be made is "ready": it
 * matches nothing.
 */
export async function prepareDescription(
  ctx: AuthedContext,
  words: string,
  waitMs: number,
): Promise<boolean> {
  const description = normalizeDescription(words);
  if (!description) {
    return true;
  }
  try {
    return (await describedVector(ctx, description, waitMs)) !== null;
  } catch {
    return true;
  }
}
