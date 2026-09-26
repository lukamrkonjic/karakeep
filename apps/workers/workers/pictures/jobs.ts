import { eq, inArray } from "drizzle-orm";

import { db } from "@karakeep/db";
import {
  bookmarkAssets,
  bookmarks,
  pictureJobRunsTable,
} from "@karakeep/db/schema";

/** Fork: what the picture jobs (fingerprints, suggestions) share. */

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
