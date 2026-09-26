import { eq } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import { pictureSettingsTable } from "@karakeep/db/schema";

/** Fork: a user's Settings → Pictures (packages/shared/types/pictures.ts). */
export type PictureSettingsRow = typeof pictureSettingsTable.$inferSelect;

/**
 * The user's picture settings. A user without any (one who signed up after
 * they came in) gets the defaults, saved, so that "new pictures" for list
 * suggestions count from now on.
 */
export async function getPictureSettings(
  db: DB,
  userId: string,
): Promise<PictureSettingsRow> {
  const find = () =>
    db.query.pictureSettingsTable.findFirst({
      where: eq(pictureSettingsTable.userId, userId),
    });
  const row = await find();
  if (row) {
    return row;
  }
  await db
    .insert(pictureSettingsTable)
    .values({ userId })
    .onConflictDoNothing();
  const created = await find();
  if (!created) {
    throw new Error(`No picture settings for user ${userId}`);
  }
  return created;
}
