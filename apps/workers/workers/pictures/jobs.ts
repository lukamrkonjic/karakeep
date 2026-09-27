import { and, eq, inArray } from "drizzle-orm";

import { db } from "@karakeep/db";
import {
  bookmarkAssets,
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  pictureJobRunsTable,
} from "@karakeep/db/schema";

/** Fork: what the picture jobs (fingerprints, suggestions…) share. */

/** Users with a picture or a video. */
export async function pictureOwners(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: bookmarks.userId })
    .from(bookmarkAssets)
    .innerJoin(bookmarks, eq(bookmarks.id, bookmarkAssets.id))
    .where(inArray(bookmarkAssets.assetType, ["image", "video"]));
  return rows.map((row) => row.userId);
}

type JobRun = typeof pictureJobRunsTable.$inferInsert;

/** Records how a user's run of a job is going. */
export async function setPictureJob(
  userId: string,
  job: JobRun["job"],
  fields: Omit<JobRun, "userId" | "job">,
) {
  await db
    .insert(pictureJobRunsTable)
    .values({ userId, job, ...fields })
    .onConflictDoUpdate({
      target: [pictureJobRunsTable.userId, pictureJobRunsTable.job],
      set: fields,
    });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The user's own manual lists: which a bookmark is in, and each list's
 * parent (for list suggestions, suggest.ts).
 */
export async function userLists(userId: string) {
  const listsOf = new Map<string, string[]>();
  for (const row of await db
    .select({
      bookmarkId: bookmarksInLists.bookmarkId,
      listId: bookmarksInLists.listId,
    })
    .from(bookmarksInLists)
    .innerJoin(bookmarkLists, eq(bookmarkLists.id, bookmarksInLists.listId))
    .where(
      and(eq(bookmarkLists.userId, userId), eq(bookmarkLists.type, "manual")),
    )) {
    listsOf.set(row.bookmarkId, [
      ...(listsOf.get(row.bookmarkId) ?? []),
      row.listId,
    ]);
  }
  const parents = new Map(
    (
      await db
        .select({ id: bookmarkLists.id, parentId: bookmarkLists.parentId })
        .from(bookmarkLists)
        .where(eq(bookmarkLists.userId, userId))
    ).map((l) => [l.id, l.parentId]),
  );
  return { listsOf, parents };
}
