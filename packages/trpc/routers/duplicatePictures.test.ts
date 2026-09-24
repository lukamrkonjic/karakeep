import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import {
  assets,
  AssetTypes,
  bookmarks,
  duplicatePicturesTable,
  pictureEmbeddingsTable,
} from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

type Api = CustomTestContext["apiCallers"][number];
type DB = CustomTestContext["db"];

/** An image bookmark of `width`×`height`, as the model saw it. */
async function picture(
  api: Api,
  db: DB,
  name: string,
  width: number,
  height: number,
) {
  const userId = (await api.users.whoami()).id;
  await db.insert(assets).values({
    id: `asset-${name}`,
    assetType: AssetTypes.UNKNOWN,
    contentType: "image/jpeg",
    size: width * 10,
    userId,
  });
  const bookmark = await api.bookmarks.createBookmark({
    type: BookmarkTypes.ASSET,
    assetType: "image",
    assetId: `asset-${name}`,
    title: name,
  });
  await db.insert(pictureEmbeddingsTable).values({
    bookmarkId: bookmark.id,
    userId,
    assetId: `asset-${name}`,
    model: "test",
    width,
    height,
    compared: true,
  });
  return bookmark.id;
}

async function alike(db: DB, api: Api, a: string, b: string, distance: number) {
  const userId = (await api.users.whoami()).id;
  const [bookmarkId, otherBookmarkId] = a < b ? [a, b] : [b, a];
  await db
    .insert(duplicatePicturesTable)
    .values({ userId, bookmarkId, otherBookmarkId, distance });
}

// Fork: Cleanups → Duplicate pictures.
describe("Duplicate pictures", () => {
  test<CustomTestContext>("groups alike pictures at the chosen level", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const small = await picture(api, db, "small", 800, 600);
    const big = await picture(api, db, "big", 2048, 1536);
    const crop = await picture(api, db, "crop", 1024, 768);
    await alike(db, api, small, big, 0.01);
    await alike(db, api, big, crop, 0.05);

    const identical = await api.duplicatePictures.list({ level: "identical" });
    expect(identical.total).toBe(1);
    expect(
      identical.groups[0].pictures.map((p) => p.bookmarkId).sort(),
    ).toEqual([small, big].sort());

    const near = await api.duplicatePictures.list({ level: "near" });
    expect(near.groups[0].pictures).toHaveLength(3);
    expect(near.groups[0].distance).toBe(0.05);
    expect(
      near.groups[0].pictures.find((p) => p.bookmarkId === big),
    ).toMatchObject({ width: 2048, height: 1536, size: 20480, kind: "image" });

    expect(await api.duplicatePictures.status()).toMatchObject({
      status: "never",
      checked: 3,
      total: 3,
    });
  });

  test<CustomTestContext>("keeping one gives it the others' lists, tags and favourite, and deletes them", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const keep = await picture(api, db, "keep", 800, 600);
    const copy = await picture(api, db, "copy", 800, 600);
    const other = await picture(api, db, "other", 800, 600);
    await alike(db, api, keep, copy, 0.01);
    await alike(db, api, copy, other, 0.02);

    const listA = await api.lists.create({ name: "A", icon: "🅰️" });
    const listB = await api.lists.create({ name: "B", icon: "🅱️" });
    await api.lists.addToList({ listId: listA.id, bookmarkId: copy });
    await api.lists.addToList({ listId: listB.id, bookmarkId: other });
    await api.bookmarks.updateTags({
      bookmarkId: other,
      attach: [{ tagName: "blue" }],
      detach: [],
    });
    await api.bookmarks.updateBookmark({ bookmarkId: copy, favourited: true });

    await api.duplicatePictures.keep({
      keepBookmarkId: keep,
      bookmarkIds: [keep, copy, other],
    });

    const kept = await api.bookmarks.getBookmark({ bookmarkId: keep });
    expect(kept.favourited).toBe(true);
    expect(kept.tags.map((t) => t.name)).toEqual(["blue"]);
    const { lists } = await api.lists.getListsOfBookmark({ bookmarkId: keep });
    expect(lists.map((l) => l.name).sort()).toEqual(["A", "B"]);
    const left = await db.query.bookmarks.findMany({
      where: inArray(bookmarks.id, [copy, other]),
    });
    expect(left).toEqual([]);
    expect((await api.duplicatePictures.list({ level: "similar" })).total).toBe(
      0,
    );
  });

  test<CustomTestContext>("keeping all of them means they are never offered again", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const a = await picture(api, db, "a", 800, 600);
    const b = await picture(api, db, "b", 800, 600);
    await alike(db, api, a, b, 0.01);

    await api.duplicatePictures.keepAll({ bookmarkIds: [a, b] });

    expect((await api.duplicatePictures.list({ level: "similar" })).total).toBe(
      0,
    );
    const pair = await db.query.duplicatePicturesTable.findFirst();
    expect(pair?.status).toBe("kept");
    expect(await db.query.bookmarks.findMany()).toHaveLength(2);
  });

  test<CustomTestContext>("keeping the best keeps each group's largest picture", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const small = await picture(api, db, "small", 800, 600);
    const big = await picture(api, db, "big", 2048, 1536);
    const far = await picture(api, db, "far", 640, 480);
    await alike(db, api, small, big, 0.01);
    // Too far apart for "near": left alone.
    await alike(db, api, big, far, 0.09);

    expect(await api.duplicatePictures.keepBest({ level: "near" })).toEqual({
      groups: 1,
      deleted: 1,
    });
    const left = (await db.query.bookmarks.findMany()).map((b) => b.id).sort();
    expect(left).toEqual([big, far].sort());
  });

  test<CustomTestContext>("pictures of another user can't be kept or deleted", async ({
    apiCallers,
    db,
  }) => {
    const mine = await picture(apiCallers[0], db, "mine", 800, 600);
    const mine2 = await picture(apiCallers[0], db, "mine2", 800, 600);

    await expect(
      apiCallers[1].duplicatePictures.keep({
        keepBookmarkId: mine,
        bookmarkIds: [mine, mine2],
      }),
    ).rejects.toThrow(/gone/);
    expect(
      await db.query.bookmarks.findMany({
        where: eq(bookmarks.id, mine2),
      }),
    ).toHaveLength(1);
  });

  test<CustomTestContext>("check now asks the workers", async ({
    apiCallers,
  }) => {
    // The mocked module (testUtils mocks it once the tests start).
    const { queueDuplicatePicturesCheck } =
      await import("@karakeep/shared-server");
    await apiCallers[0].duplicatePictures.check();
    expect(queueDuplicatePicturesCheck).toHaveBeenCalled();
  });
});
