import { beforeEach, describe, expect, test } from "vitest";

import type { ZProjectItem } from "@karakeep/shared/types/projects";
import {
  assets,
  AssetTypes,
  pictureEmbeddingsTable,
  picturePalettesTable,
} from "@karakeep/db/schema";
import { PICTURE_WIDTH } from "@karakeep/shared/projectLayout";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

// Fork: projects — boards to lay pictures out on (routers/projects.ts).

type Api = CustomTestContext["apiCallers"][number];
type DB = CustomTestContext["db"];

/** A picture bookmark; with a size, as the picture index read it. */
async function picture(
  api: Api,
  db: DB,
  name: string,
  size?: { width: number; height: number },
) {
  const userId = (await api.users.whoami()).id;
  await db.insert(assets).values({
    id: `asset-${name}`,
    assetType: AssetTypes.UNKNOWN,
    contentType: "image/jpeg",
    size: 1000,
    userId,
  });
  const { id } = await api.bookmarks.createBookmark({
    type: BookmarkTypes.ASSET,
    assetType: "image",
    assetId: `asset-${name}`,
    title: name,
  });
  if (size) {
    await db.insert(pictureEmbeddingsTable).values({
      bookmarkId: id,
      userId,
      assetId: `asset-${name}`,
      model: "test",
      embedding: null,
      ...size,
    });
  }
  return id;
}

const note = (
  id: string,
  text: string,
  box: Partial<ZProjectItem> = {},
): ZProjectItem => ({
  id,
  kind: "note",
  bookmarkId: null,
  text,
  style: { size: "l", colour: "none" },
  x: 0,
  y: 0,
  w: 300,
  h: 60,
  z: 0,
  ...box,
});

describe("Projects", () => {
  test<CustomTestContext>("make, rename, list newest first, delete", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0];
    const outpath = await api.projects.create({ name: "  Outpath  " });
    expect(outpath).toMatchObject({
      name: "Outpath",
      description: null,
      numPictures: 0,
      numNotes: 0,
      cover: [],
    });
    const arena = await api.projects.create({
      name: "Arena",
      description: "Hunt mode",
    });
    // The last changed first: renaming one brings it up.
    await new Promise((r) => setTimeout(r, 1100));
    const renamed = await api.projects.update({
      projectId: outpath.id,
      name: "Outpath: Cloudroot",
      description: null,
    });
    expect(renamed.name).toBe("Outpath: Cloudroot");
    const { projects } = await api.projects.list();
    expect(projects.map((p) => p.name)).toEqual([
      "Outpath: Cloudroot",
      "Arena",
    ]);
    expect(projects[1].description).toBe("Hunt mode");

    await expect(api.projects.create({ name: "   " })).rejects.toThrow();

    await api.projects.delete({ projectId: arena.id });
    expect((await api.projects.list()).projects).toHaveLength(1);
    await expect(api.projects.get({ projectId: arena.id })).rejects.toThrow(
      /not found/i,
    );
  });

  test<CustomTestContext>("another user's project is out of reach", async ({
    apiCallers,
    db,
  }) => {
    const [api, other] = apiCallers;
    const mine = await api.projects.create({ name: "Mine" });
    const theirPicture = await picture(other, db, "theirs");
    expect((await other.projects.list()).projects).toEqual([]);
    for (const call of [
      () => other.projects.get({ projectId: mine.id }),
      () => other.projects.update({ projectId: mine.id, name: "Taken" }),
      () => other.projects.delete({ projectId: mine.id }),
      () =>
        other.projects.addBookmarks({
          projectId: mine.id,
          bookmarkIds: [theirPicture],
        }),
      () =>
        other.projects.saveItems({
          projectId: mine.id,
          upsert: [note("n1", "hi")],
          remove: [],
        }),
    ]) {
      await expect(call()).rejects.toThrow(/not found/i);
    }
    // Their picture can't go on my board either.
    const added = await api.projects.addBookmarks({
      projectId: mine.id,
      bookmarkIds: [theirPicture],
    });
    expect(added).toEqual({ itemIds: [], existingItemIds: [], skipped: 1 });
  });

  test<CustomTestContext>("pictures added from elsewhere: placed, once", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const project = await api.projects.create({ name: "Board" });
    const wide = await picture(api, db, "wide", { width: 800, height: 400 });
    const unknown = await picture(api, db, "unknown");
    const seen = await picture(api, db, "seen");

    const first = await api.projects.addBookmarks({
      projectId: project.id,
      bookmarkIds: [wide, unknown, seen, wide],
      sizes: { [seen]: { w: 100, h: 300 } },
    });
    expect(first.itemIds).toHaveLength(3);
    expect(first.skipped).toBe(0);

    const board = await api.projects.get({ projectId: project.id });
    expect(board.bookmarks.map((b) => b.id).sort()).toEqual(
      [wide, unknown, seen].sort(),
    );
    const itemOf = (id: string) =>
      board.items.find((i) => i.bookmarkId === id)!;
    // Its own shape: the index's, the client's, or a guess.
    expect(itemOf(wide)).toMatchObject({
      kind: "bookmark",
      w: PICTURE_WIDTH,
      h: PICTURE_WIDTH / 2,
    });
    expect(itemOf(seen).h).toBe(PICTURE_WIDTH * 3);
    expect(itemOf(unknown).h).toBeGreaterThan(PICTURE_WIDTH);
    expect(board.sizes[wide]).toEqual({ w: 800, h: 400 });
    // Each on top of the one before.
    expect(itemOf(seen).z).toBeGreaterThan(itemOf(wide).z);

    // Again: what's there stays put; a new one goes to the right of it all.
    const more = await picture(api, db, "more");
    const second = await api.projects.addBookmarks({
      projectId: project.id,
      bookmarkIds: [wide, more],
    });
    expect(second.existingItemIds).toEqual([itemOf(wide).id]);
    expect(second.itemIds).toHaveLength(1);
    const after = await api.projects.get({ projectId: project.id });
    const right = Math.max(...board.items.map((i) => i.x + i.w));
    const added = after.items.find((i) => i.bookmarkId === more)!;
    expect(added.x).toBeGreaterThan(right);
    expect(after.items.find((i) => i.bookmarkId === wide)).toEqual(
      itemOf(wide),
    );

    // Around a point: a drop.
    const dropped = await picture(api, db, "dropped", {
      width: 100,
      height: 100,
    });
    await api.projects.addBookmarks({
      projectId: project.id,
      bookmarkIds: [dropped],
      at: { x: 1000, y: -500 },
    });
    const placed = (
      await api.projects.get({ projectId: project.id })
    ).items.find((i) => i.bookmarkId === dropped)!;
    expect(placed.x + placed.w / 2).toBe(1000);
    expect(placed.y + placed.h / 2).toBe(-500);

    // Which boards a picture is on.
    expect(await api.projects.ofBookmark({ bookmarkId: wide })).toEqual({
      projectIds: [project.id],
    });
    expect(await api.projects.ofBookmark({ bookmarkId: "nope" })).toEqual({
      projectIds: [],
    });
  });

  test<CustomTestContext>("the board's own changes", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const project = await api.projects.create({ name: "Board" });
    const other = await api.projects.create({ name: "Other" });
    const pic = await picture(api, db, "pic");
    const pic2 = await picture(api, db, "pic2");

    const item: ZProjectItem = {
      id: "item-pic",
      kind: "bookmark",
      bookmarkId: pic,
      text: null,
      style: null,
      x: 10,
      y: 20,
      w: 200,
      h: 300,
      z: 1,
    };
    expect(
      await api.projects.saveItems({
        projectId: project.id,
        upsert: [item, note("note-1", "Characters", { x: -50, y: -100 })],
        remove: [],
      }),
    ).toEqual({ saved: 2, removed: 0 });
    let board = await api.projects.get({ projectId: project.id });
    expect(board.project).toMatchObject({ numPictures: 1, numNotes: 1 });
    expect(board.items.find((i) => i.id === "note-1")).toMatchObject({
      text: "Characters",
      style: { size: "l", colour: "none" },
    });

    // Moved, written in, the other taken off.
    await api.projects.saveItems({
      projectId: project.id,
      upsert: [
        { ...item, x: 500, y: 600, w: 400, h: 600, z: 5 },
        note("note-1", "Characters and places", {
          style: { size: "m", colour: "yellow" },
        }),
      ],
      remove: [],
    });
    board = await api.projects.get({ projectId: project.id });
    expect(board.items.find((i) => i.id === "item-pic")).toEqual({
      ...item,
      x: 500,
      y: 600,
      w: 400,
      h: 600,
      z: 5,
    });
    expect(board.items.find((i) => i.id === "note-1")).toMatchObject({
      text: "Characters and places",
      style: { size: "m", colour: "yellow" },
    });
    expect(
      await api.projects.saveItems({
        projectId: project.id,
        upsert: [],
        remove: ["note-1", "not-there"],
      }),
    ).toEqual({ saved: 0, removed: 1 });

    // A picture already on the board isn't put on it twice.
    await api.projects.saveItems({
      projectId: project.id,
      upsert: [{ ...item, id: "item-pic-again" }],
      remove: [],
    });
    board = await api.projects.get({ projectId: project.id });
    expect(board.items.map((i) => i.id)).toEqual(["item-pic"]);
    // Unless it's taken off in the same batch (an undo putting it back).
    await api.projects.saveItems({
      projectId: project.id,
      upsert: [{ ...item, id: "item-pic-again" }],
      remove: ["item-pic"],
    });
    board = await api.projects.get({ projectId: project.id });
    expect(board.items.map((i) => i.id)).toEqual(["item-pic-again"]);

    // Another project's item can't be touched from here.
    await api.projects.saveItems({
      projectId: other.id,
      upsert: [{ ...item, id: "other-item", bookmarkId: pic2 }],
      remove: [],
    });
    await expect(
      api.projects.saveItems({
        projectId: project.id,
        upsert: [{ ...item, id: "other-item", bookmarkId: pic2 }],
        remove: [],
      }),
    ).rejects.toThrow(/another project/);
    await api.projects.saveItems({
      projectId: project.id,
      upsert: [],
      remove: ["other-item"],
    });
    expect(
      (await api.projects.get({ projectId: other.id })).items,
    ).toHaveLength(1);

    // A note is words with a look; a picture is a bookmark.
    await expect(
      api.projects.saveItems({
        projectId: project.id,
        upsert: [{ ...item, id: "bad", text: "words" }],
        remove: [],
      }),
    ).rejects.toThrow();
    await expect(
      api.projects.saveItems({
        projectId: project.id,
        upsert: [{ ...note("bad", "x"), style: null }],
        remove: [],
      }),
    ).rejects.toThrow();
    await expect(
      api.projects.saveItems({
        projectId: project.id,
        upsert: [{ ...note("bad", "x"), x: Infinity }],
        remove: [],
      }),
    ).rejects.toThrow();
  });

  test<CustomTestContext>("covers, colours, and a deleted picture", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const userId = (await api.users.whoami()).id;
    const project = await api.projects.create({ name: "Board" });
    const small = await picture(api, db, "small");
    const big = await picture(api, db, "big");
    const link = await api.bookmarks.createBookmark({
      type: BookmarkTypes.LINK,
      url: "https://example.com",
    });
    await db.insert(assets).values({
      id: "asset-banner",
      assetType: AssetTypes.LINK_BANNER_IMAGE,
      contentType: "image/jpeg",
      size: 1000,
      userId,
      bookmarkId: link.id,
    });
    await db.insert(picturePalettesTable).values({
      bookmarkId: big,
      userId,
      assetId: "asset-big",
      colours: [{ hex: "#286ff0", share: 0.8 }],
      sortKey: 1,
    });
    const box = { text: null, style: null, x: 0, y: 0, z: 0 };
    await api.projects.saveItems({
      projectId: project.id,
      upsert: [
        { ...box, id: "s", kind: "bookmark", bookmarkId: small, w: 10, h: 10 },
        { ...box, id: "b", kind: "bookmark", bookmarkId: big, w: 500, h: 500 },
        {
          ...box,
          id: "l",
          kind: "bookmark",
          bookmarkId: link.id,
          w: 100,
          h: 100,
        },
      ],
      remove: [],
    });
    const { projects } = await api.projects.list();
    // The biggest on the board first; a link shows its banner.
    expect(projects[0].cover).toEqual([
      { assetId: "asset-big", video: false },
      { assetId: "asset-banner", video: false },
      { assetId: "asset-small", video: false },
    ]);
    const board = await api.projects.get({ projectId: project.id });
    expect(board.colours[big]).toEqual([{ hex: "#286ff0", share: 0.8 }]);

    // Deleting a bookmark takes it off every board.
    await api.bookmarks.deleteBookmark({ bookmarkId: big });
    expect(
      (await api.projects.get({ projectId: project.id })).items.map(
        (i) => i.id,
      ),
    ).toEqual(["s", "l"]);
    // Deleting the project leaves the pictures be.
    await api.projects.delete({ projectId: project.id });
    expect((await api.bookmarks.getBookmark({ bookmarkId: small })).id).toBe(
      small,
    );
  });
});
