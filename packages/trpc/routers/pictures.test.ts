import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import {
  assets,
  AssetTypes,
  pictureEmbeddingsTable,
  pictureListSuggestionsTable,
  pictureSettingsTable,
  pictureTextQueriesTable,
} from "@karakeep/db/schema";
import {
  CLIP_MODEL_ID,
  normalizeDescription,
  pictureTextQueryId,
  vectorToBuffer,
} from "@karakeep/shared-server";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

type Api = CustomTestContext["apiCallers"][number];
type DB = CustomTestContext["db"];

/** A fingerprint pointing `degrees` round a circle (length 1). */
const at = (degrees: number) => {
  const r = (degrees * Math.PI) / 180;
  return Float32Array.from([Math.cos(r), Math.sin(r)]);
};

/** An image bookmark with a fingerprint. */
async function picture(api: Api, db: DB, name: string, degrees: number) {
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

const titles = (page: { bookmarks: { title?: string | null }[] }) =>
  page.bookmarks.map((b) => b.title);

// Fork: Settings → Pictures and what rests on the fingerprints.
describe("Pictures", () => {
  test<CustomTestContext>("settings: the defaults, changed one at a time", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0].pictures;
    expect(await api.settings()).toMatchObject({
      fingerprintSchedule: "hourly",
      similarEnabled: true,
      describeEnabled: true,
      suggestionsEnabled: true,
      suggestionsScope: "new",
      duplicatesSchedule: "nightly",
      importDuplicateLevel: "near",
    });
    expect(await api.updateSettings({ similarLevel: "close" })).toMatchObject({
      similarLevel: "close",
      describeLevel: "balanced",
    });

    // Turned back on, "new pictures" count from then.
    const userId = (await apiCallers[0].users.whoami()).id;
    const since = async () =>
      (await db.query.pictureSettingsTable.findFirst({
        where: eq(pictureSettingsTable.userId, userId),
      }))!.suggestionsSince.getTime();
    await db
      .update(pictureSettingsTable)
      .set({ suggestionsSince: new Date(1_000_000_000_000) })
      .where(eq(pictureSettingsTable.userId, userId));
    await api.updateSettings({ suggestionsEnabled: false });
    expect(await since()).toBe(1_000_000_000_000);
    await api.updateSettings({ suggestionsEnabled: true });
    expect(await since()).toBeGreaterThan(1_000_000_000_000);
  });

  test<CustomTestContext>("more like this: the closest first, as close as asked", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    const a = await picture(caller, db, "a", 0);
    await picture(caller, db, "b", 10); // 0.015 away
    await picture(caller, db, "c", 35); // 0.18
    await picture(caller, db, "d", 45); // 0.29
    await picture(caller, db, "e", 90); // 1

    const similar = () => caller.pictures.similar({ bookmarkId: a });
    expect(titles(await similar())).toEqual(["b", "c"]); // related: 0.22
    await caller.pictures.updateSettings({ similarLevel: "loose" });
    expect(titles(await similar())).toEqual(["b", "c", "d"]);
    await caller.pictures.updateSettings({ similarLevel: "close" });
    expect(titles(await similar())).toEqual(["b"]);

    // A page at a time.
    await caller.pictures.updateSettings({ similarLevel: "loose" });
    const first = await caller.pictures.similar({ bookmarkId: a, limit: 2 });
    expect(titles(first)).toEqual(["b", "c"]);
    expect(first).toMatchObject({ nextCursor: 2, total: 3 });
    expect(
      titles(
        await caller.pictures.similar({ bookmarkId: a, limit: 2, cursor: 2 }),
      ),
    ).toEqual(["d"]);

    // Turned off, or someone else's picture: nothing.
    expect(
      (await apiCallers[1].pictures.similar({ bookmarkId: a })).total,
    ).toBe(0);
    await caller.pictures.updateSettings({ similarEnabled: false });
    expect((await similar()).total).toBe(0);
  });

  test<CustomTestContext>("search by description, narrowed by the search's qualifiers", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    await picture(caller, db, "a", 0);
    await picture(caller, db, "b", 10);
    const c = await picture(caller, db, "c", 35);
    await picture(caller, db, "d", 45);
    // The workers made this description's fingerprint already: pointing at
    // 90°, it's sin(angle) like each picture.
    const description = normalizeDescription("  Red   CHAIR ");
    await db.insert(pictureTextQueriesTable).values({
      id: pictureTextQueryId(description),
      text: description,
      embedding: vectorToBuffer(at(90)),
    });

    const search = (text: string) =>
      caller.pictures.searchByDescription({ text });
    // balanced: 0.23 at least.
    expect(await search("red chair")).toMatchObject({ status: "ready" });
    expect(titles(await search("red chair"))).toEqual(["d", "c"]);
    await caller.bookmarks.updateBookmark({ bookmarkId: c, favourited: true });
    expect(titles(await search("red chair is:fav"))).toEqual(["c"]);
    expect(titles(await search("is:fav"))).toEqual([]);

    await caller.pictures.updateSettings({ describeEnabled: false });
    expect(await search("red chair")).toMatchObject({
      status: "off",
      total: 0,
    });
  });

  test<CustomTestContext>("list suggestions: added, dismissed, or already there", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    const userId = (await caller.users.whoami()).id;
    const a = await picture(caller, db, "a", 0);
    const art = await caller.lists.create({
      name: "Art",
      icon: "🎨",
      type: "manual",
    });
    const cars = await caller.lists.create({
      name: "Cars",
      icon: "",
      type: "manual",
    });
    const moods = await caller.lists.create({
      name: "Moods",
      icon: "",
      type: "manual",
    });
    await db.insert(pictureListSuggestionsTable).values([
      { userId, bookmarkId: a, listId: art.id, score: 0.8 },
      { userId, bookmarkId: a, listId: cars.id, score: 0.5 },
      { userId, bookmarkId: a, listId: moods.id, score: 0.9 },
    ]);
    const suggested = async () =>
      (await caller.pictures.suggestionsFor({ bookmarkId: a })).map(
        (s) => s.name,
      );
    expect(await suggested()).toEqual(["Moods", "Art", "Cars"]);

    // Put in Moods by hand meanwhile: no longer suggested.
    await caller.lists.addToList({ listId: moods.id, bookmarkId: a });
    expect(await suggested()).toEqual(["Art", "Cars"]);

    const groups = (await caller.pictures.suggestionGroups()).groups;
    expect(groups.map((g) => g.list.name).sort()).toEqual(["Art", "Cars"]);
    expect(groups[0].pictures[0]).toMatchObject({
      bookmarkId: a,
      kind: "image",
      imageAssetId: "asset-a",
    });

    const [artSuggestion, carsSuggestion] =
      await caller.pictures.suggestionsFor({ bookmarkId: a });
    // Not someone else's to act on.
    expect(
      await apiCallers[1].pictures.acceptSuggestions({
        ids: [artSuggestion.id],
      }),
    ).toEqual({ added: 0 });
    expect(
      await caller.pictures.acceptSuggestions({ ids: [artSuggestion.id] }),
    ).toEqual({ added: 1 });
    const inLists = await caller.lists.getListsOfBookmark({ bookmarkId: a });
    expect(inLists.lists.map((l) => l.name).sort()).toEqual(["Art", "Moods"]);

    await caller.pictures.dismissSuggestions({ ids: [carsSuggestion.id] });
    expect(await suggested()).toEqual([]);
    expect((await caller.pictures.status()).suggestions.open).toBe(0);
  });

  test<CustomTestContext>("status: every picture, a video on a note too", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    const userId = (await caller.users.whoami()).id;
    await picture(caller, db, "a", 0);
    // A note carrying a video counts by the video's first frame.
    const note = await caller.bookmarks.createBookmark({
      type: BookmarkTypes.TEXT,
      text: "a note with a video",
    });
    await db.insert(assets).values({
      id: "frame-note",
      assetType: AssetTypes.LINK_VIDEO_THUMBNAIL,
      contentType: "image/jpeg",
      size: 10,
      userId,
      bookmarkId: note.id,
    });
    const fingerprints = async () =>
      (await caller.pictures.status()).fingerprints;
    expect(await fingerprints()).toMatchObject({
      status: "never",
      done: 1,
      unreadable: 0,
      total: 2,
    });

    // Looked at but unreadable: counted apart.
    await db.insert(pictureEmbeddingsTable).values({
      bookmarkId: note.id,
      userId,
      assetId: "frame-note",
      model: CLIP_MODEL_ID,
      compared: true,
      suggested: true,
    });
    expect(await fingerprints()).toMatchObject({
      done: 1,
      unreadable: 1,
      total: 2,
    });
    // One of another model or file doesn't count: it's done again.
    await db
      .update(pictureEmbeddingsTable)
      .set({ model: "another" })
      .where(eq(pictureEmbeddingsTable.bookmarkId, note.id));
    expect(await fingerprints()).toMatchObject({ done: 1, unreadable: 0 });
    expect((await caller.pictures.status()).models).toEqual({
      picture: false,
      text: false,
    });
  });
});
