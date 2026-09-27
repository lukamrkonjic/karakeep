import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import {
  assets,
  AssetTypes,
  bookmarks,
  pictureEmbeddingsTable,
  pictureSeenTable,
} from "@karakeep/db/schema";
import { CLIP_MODEL_ID, vectorToBuffer } from "@karakeep/shared-server";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

type Api = CustomTestContext["apiCallers"][number];
type DB = CustomTestContext["db"];

const DAY = 24 * 3600_000;

/** A fingerprint pointing `degrees` round a circle (length 1). */
const at = (degrees: number) => {
  const r = (degrees * Math.PI) / 180;
  return Float32Array.from([Math.cos(r), Math.sin(r)]);
};

/** A picture with a fingerprint, saved `daysAgo`. */
async function picture(
  api: Api,
  db: DB,
  name: string,
  degrees: number,
  daysAgo: number,
) {
  const userId = (await api.users.whoami()).id;
  await db.insert(assets).values({
    id: `asset-${name}`,
    assetType: AssetTypes.UNKNOWN,
    contentType: "image/jpeg",
    size: 1000,
    userId,
  });
  const bookmark = await api.bookmarks.createBookmark({
    type: BookmarkTypes.ASSET,
    assetType: "image",
    assetId: `asset-${name}`,
    title: name,
  });
  await db
    .update(bookmarks)
    .set({ dbCreatedAt: new Date(Date.now() - daysAgo * DAY) })
    .where(eq(bookmarks.id, bookmark.id));
  await db.insert(pictureEmbeddingsTable).values({
    bookmarkId: bookmark.id,
    userId,
    assetId: `asset-${name}`,
    model: CLIP_MODEL_ID,
    embedding: vectorToBuffer(at(degrees)),
    compared: true,
    suggested: true,
  });
  return bookmark.id;
}

// Fork: Discover — your own pictures you haven't seen in a while.
describe("Discover", () => {
  test<CustomTestContext>("old pictures like what you save lately; not the new, opened or archived ones", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    await picture(api, db, "new sofa", 0, 1);
    await picture(api, db, "old sofa", 25, 90);
    await picture(api, db, "old car", 150, 90);
    const opened = await picture(api, db, "opened sofa", 60, 90);
    const archived = await picture(api, db, "archived sofa", 45, 90);
    await api.discover.opened({ bookmarkId: opened });
    await api.bookmarks.updateBookmark({
      bookmarkId: archived,
      archived: true,
    });

    const first = await api.discover.items();
    expect(first.bookmarks.map((b) => b.title)).toEqual([
      "old sofa",
      "old car",
    ]);
    expect(first.pickedAt).not.toBeNull();

    // The same set all day.
    const again = await api.discover.items();
    expect(again.pickedAt).toEqual(first.pickedAt);
    expect(again.bookmarks.map((b) => b.id)).toEqual(
      first.bookmarks.map((b) => b.id),
    );

    // Shuffle: a new set (in a library this small, the same pictures).
    await api.discover.shuffle();
    const shuffled = await api.discover.items();
    expect(shuffled.pickedAt!.getTime()).toBeGreaterThan(
      first.pickedAt!.getTime(),
    );
    expect(shuffled.bookmarks).toHaveLength(2);
  });

  test<CustomTestContext>("opened: only your own pictures; nothing to show without any", async ({
    apiCallers,
    db,
  }) => {
    const mine = await picture(apiCallers[0], db, "mine", 0, 90);
    await expect(
      apiCallers[1].discover.opened({ bookmarkId: mine }),
    ).rejects.toThrow(/Not found/);
    await apiCallers[0].discover.opened({ bookmarkId: mine });
    const seen = await db.query.pictureSeenTable.findFirst({
      where: eq(pictureSeenTable.bookmarkId, mine),
    });
    expect(seen?.openedAt).toBeInstanceOf(Date);

    expect(await apiCallers[1].discover.items()).toEqual({
      bookmarks: [],
      pickedAt: null,
    });
  });
});
