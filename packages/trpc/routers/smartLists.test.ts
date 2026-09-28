import { beforeEach, describe, expect, test } from "vitest";

import type {
  ZSmartListRules,
  ZSmartRule,
} from "@karakeep/shared/types/smartLists";
import {
  assets,
  AssetTypes,
  pictureEmbeddingsTable,
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

// Fork: smart lists made of rules (routers/smartLists.ts), and the
// conditions they brought to the search language (lib/search.ts).

type Api = CustomTestContext["apiCallers"][number];
type DB = CustomTestContext["db"];

const all = (...rules: ZSmartRule[]): ZSmartListRules => ({
  groups: [{ match: "all", negate: false, rules }],
});

async function note(api: Api, title: string) {
  return (
    await api.bookmarks.createBookmark({
      type: BookmarkTypes.TEXT,
      text: title,
      title,
    })
  ).id;
}

/** A picture, video or PDF bookmark. */
async function file(
  api: Api,
  db: DB,
  name: string,
  assetType: "image" | "video" | "pdf",
  opts: { title?: string | null; fileName?: string } = {},
) {
  const userId = (await api.users.whoami()).id;
  await db.insert(assets).values({
    id: `asset-${name}`,
    assetType: AssetTypes.UNKNOWN,
    contentType: {
      image: "image/jpeg",
      video: "video/mp4",
      pdf: "application/pdf",
    }[assetType],
    size: 1000,
    userId,
  });
  return (
    await api.bookmarks.createBookmark({
      type: BookmarkTypes.ASSET,
      assetType,
      assetId: `asset-${name}`,
      title: opts.title === undefined ? name : opts.title,
      fileName: opts.fileName,
    })
  ).id;
}

/** What a smart list of these rules holds, by title. */
async function matching(api: Api, rules: ZSmartListRules) {
  const list = await api.smartLists.create({ name: "Test", icon: "", rules });
  const { bookmarks } = await api.bookmarks.getBookmarks({
    listId: list.id,
    includeContent: false,
  });
  return bookmarks.map((b) => b.title ?? b.id).sort();
}

describe("Smart lists made of rules", () => {
  test<CustomTestContext>("its query, what it holds, its rules back", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0];
    const a = await note(api, "a");
    await note(api, "b");
    await api.bookmarks.updateBookmark({ bookmarkId: a, favourited: true });

    const favourites = all({ field: "favourite", op: "is", value: "yes" });
    const list = await api.smartLists.create({
      name: "Favourites too",
      icon: "⭐",
      rules: favourites,
    });
    expect(list).toMatchObject({ type: "smart", query: "is:fav", icon: "⭐" });
    expect(await matching(api, favourites)).toEqual(["a"]);
    expect(await api.smartLists.rules({ listId: list.id })).toEqual({
      rules: favourites,
    });

    // Two groups, one of them false: kept as they were made.
    const rules: ZSmartListRules = {
      groups: [
        {
          match: "all",
          negate: true,
          rules: [{ field: "favourite", op: "is", value: "yes" }],
        },
        {
          match: "any",
          negate: false,
          rules: [
            { field: "name", op: "contains", value: "b" },
            { field: "name", op: "contains", value: "c" },
          ],
        },
      ],
    };
    const updated = await api.smartLists.update({
      listId: list.id,
      name: "Not favourites",
      rules,
    });
    expect(updated).toMatchObject({
      name: "Not favourites",
      query: "-is:fav (title:b or title:c)",
    });
    expect(await api.smartLists.rules({ listId: list.id })).toEqual({ rules });

    // Its query changed elsewhere (the API): the rules are read from it.
    await api.lists.edit({ listId: list.id, query: "is:fav color:red" });
    expect(await api.smartLists.rules({ listId: list.id })).toEqual({
      rules: all(
        { field: "favourite", op: "is", value: "yes" },
        { field: "colour", op: "is", value: "red" },
      ),
    });

    // Only complete rules; only your own lists.
    await expect(
      api.smartLists.create({
        name: "Empty",
        icon: "",
        rules: all({ field: "name", op: "contains", value: " " }),
      }),
    ).rejects.toThrow(/Every rule needs a value/);
    await expect(
      apiCallers[1].smartLists.rules({ listId: list.id }),
    ).rejects.toThrow();
    await expect(
      apiCallers[1].smartLists.update({ listId: list.id, name: "Mine" }),
    ).rejects.toThrow();
    const manual = await api.lists.create({ name: "Manual", icon: "" });
    await expect(
      api.smartLists.update({ listId: manual.id, rules: favourites }),
    ).rejects.toThrow(/Not a smart list/);
  });

  test<CustomTestContext>("the editor's count", async ({ apiCallers }) => {
    const api = apiCallers[0];
    for (const title of ["a", "b", "c"]) {
      const id = await note(api, title);
      if (title !== "c") {
        await api.bookmarks.updateBookmark({
          bookmarkId: id,
          favourited: true,
        });
      }
    }
    const preview = (rules: ZSmartListRules) =>
      api.smartLists.preview({ rules });
    expect(
      await preview(all({ field: "favourite", op: "is", value: "yes" })),
    ).toEqual({ count: 2, preparing: false });
    // Only the rules complete so far count.
    expect(
      await preview(
        all(
          { field: "favourite", op: "is", value: "no" },
          { field: "name", op: "contains", value: "" },
        ),
      ),
    ).toEqual({ count: 1, preparing: false });
    expect(
      await preview(all({ field: "name", op: "contains", value: "" })),
    ).toEqual({ count: 0, preparing: false });
    // Someone else's bookmarks are never counted.
    expect(
      await apiCallers[1].smartLists.preview({
        rules: all({ field: "favourite", op: "is", value: "yes" }),
      }),
    ).toEqual({ count: 0, preparing: false });
  });

  test<CustomTestContext>("Lists: a list and everything under it", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0];
    const parent = await api.lists.create({ name: "Parent", icon: "" });
    const child = await api.lists.create({
      name: "Child",
      icon: "",
      parentId: parent.id,
    });
    const other = await api.lists.create({ name: "Other", icon: "" });
    for (const [title, list] of [
      ["a", parent],
      ["b", child],
      ["c", other],
      ["d", null],
    ] as const) {
      const id = await note(api, title);
      if (list) {
        await api.lists.addToList({ listId: list.id, bookmarkId: id });
      }
    }
    const lists = (op: string, value?: string) =>
      matching(api, all({ field: "lists", op, value }));
    expect(await lists("contains", parent.id)).toEqual(["a", "b"]);
    expect(await lists("contains", child.id)).toEqual(["b"]);
    expect(await lists("not_contains", parent.id)).toEqual(["c", "d"]);
    expect(await lists("empty")).toEqual(["d"]);
    expect(await lists("not_empty")).toEqual(["a", "b", "c"]);

    // A smart list in a smart list; one in itself holds nothing, and ends.
    const inParent = await api.smartLists.create({
      name: "In parent",
      icon: "",
      rules: all({ field: "lists", op: "contains", value: parent.id }),
    });
    expect(await lists("contains", inParent.id)).toEqual(["a", "b"]);
    await api.smartLists.update({
      listId: inParent.id,
      rules: all({ field: "lists", op: "contains", value: inParent.id }),
    });
    expect(await lists("contains", inParent.id)).toEqual([]);

    // Renamed, it's still the same list; gone, it holds nothing.
    await api.lists.edit({ listId: parent.id, name: "Renamed" });
    expect(await lists("contains", parent.id)).toEqual(["a", "b"]);
    await api.lists.delete({ listId: child.id });
    await api.lists.delete({ listId: parent.id });
    expect(await lists("contains", parent.id)).toEqual([]);
    expect(await lists("not_contains", parent.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test<CustomTestContext>("Type: pictures, videos, PDFs, notes, links", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const userId = (await api.users.whoami()).id;
    await file(api, db, "picture", "image");
    await file(api, db, "video", "video");
    await file(api, db, "pdf", "pdf");
    await note(api, "note");
    // An imported video: a note carrying one. It's a video, not a note.
    const videoNote = await note(api, "video note");
    await db.insert(assets).values({
      id: "asset-video-note",
      assetType: AssetTypes.LINK_VIDEO,
      contentType: "video/mp4",
      size: 1000,
      bookmarkId: videoNote,
      userId,
    });
    const link = await api.bookmarks.createBookmark({
      type: BookmarkTypes.LINK,
      url: "https://example.com",
      title: "link",
    });
    expect(link.title).toEqual("link");

    const type = (op: string, value: string) =>
      matching(api, all({ field: "type", op, value }));
    expect(await type("is", "picture")).toEqual(["picture"]);
    expect(await type("is", "video")).toEqual(["video", "video note"]);
    expect(await type("is", "pdf")).toEqual(["pdf"]);
    expect(await type("is", "note")).toEqual(["note"]);
    expect(await type("is", "link")).toEqual(["link"]);
    expect(await type("is_not", "video")).toEqual([
      "link",
      "note",
      "pdf",
      "picture",
    ]);
  });

  test<CustomTestContext>("Picture shows: what the picture model sees", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const userId = (await api.users.whoami()).id;
    /** A fingerprint pointing `degrees` round a circle (length 1). */
    const at = (degrees: number) => {
      const r = (degrees * Math.PI) / 180;
      return Float32Array.from([Math.cos(r), Math.sin(r)]);
    };
    for (const [name, degrees] of [
      ["a", 0],
      ["b", 45],
      ["c", 80],
    ] as const) {
      const id = await file(api, db, name, "image");
      await db.insert(pictureEmbeddingsTable).values({
        bookmarkId: id,
        userId,
        assetId: `asset-${name}`,
        model: CLIP_MODEL_ID,
        embedding: vectorToBuffer(at(degrees)),
        compared: true,
        suggested: true,
      });
    }
    await note(api, "note");
    // The workers read this description already: it points at 90°.
    const description = normalizeDescription("Red Bag");
    await db.insert(pictureTextQueriesTable).values({
      id: pictureTextQueryId(description),
      text: description,
      embedding: vectorToBuffer(at(90)),
    });

    const shows = all({ field: "picture", op: "shows", value: "red bag" });
    // Balanced (the default): 0.23 alike at least — cos(45°), cos(10°).
    expect(await matching(api, shows)).toEqual(["b", "c"]);
    expect(
      await matching(
        api,
        all({ field: "picture", op: "not_shows", value: "red  BAG" }),
      ),
    ).toEqual(["a", "note"]);
    expect(await api.smartLists.preview({ rules: shows })).toEqual({
      count: 2,
      preparing: false,
    });
    // It narrows like any rule.
    expect(
      await matching(api, {
        groups: [
          { ...shows.groups[0] },
          {
            match: "all",
            negate: false,
            rules: [{ field: "name", op: "contains", value: "c" }],
          },
        ],
      }),
    ).toEqual(["c"]);
  });

  test<CustomTestContext>("Name: an untitled picture by its file name", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const untitled = await file(api, db, "untitled", "image", {
      title: null,
      fileName: "IMG_1234.jpg",
    });
    await file(api, db, "titled", "image", {
      title: "Beach",
      fileName: "IMG_9999.jpg",
    });
    const name = (op: string, value: string) =>
      matching(api, all({ field: "name", op, value }));
    expect(await name("contains", "img_12")).toEqual([untitled]);
    // Named, its file name isn't its name.
    expect(await name("contains", "IMG_99")).toEqual([]);
    expect(await name("not_contains", "IMG_12")).toEqual(["Beach"]);
    expect(await name("not_contains", "IMG_99")).toEqual(["Beach", untitled]);
  });
});
