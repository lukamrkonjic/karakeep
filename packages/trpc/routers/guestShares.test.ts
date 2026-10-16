import { beforeEach, describe, expect, test } from "vitest";

import { assets, AssetTypes } from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { guestCanSeeAsset, guestShareScope } from "../lib/guestShares";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

// Fork: guest links (routers/guestShares.ts).

type Api = CustomTestContext["apiCallers"][number];

async function note(api: Api, text: string, listId?: string) {
  const { id } = await api.bookmarks.createBookmark({
    type: BookmarkTypes.TEXT,
    text,
  });
  if (listId) {
    await api.lists.addToList({ listId, bookmarkId: id });
  }
  return id;
}

async function list(api: Api, name: string, parentId?: string) {
  const { id } = await api.lists.create({
    name,
    icon: "🎁",
    type: "manual",
    parentId,
  });
  return id;
}

describe("guest links", () => {
  test<CustomTestContext>("show only the lists ticked for them", async ({
    apiCallers,
    unauthedAPICaller: guest,
  }) => {
    const owner = apiCallers[0];
    const wishes = await list(owner, "Wishes");
    const under = await list(owner, "Shoes", wishes);
    const secret = await list(owner, "Secret");
    const shown = await note(owner, "a lamp", wishes);
    await note(owner, "running shoes", under);
    await note(owner, "a surprise", secret);

    const share = await owner.guestShares.create({ listIds: [wishes] });
    const view = await guest.guestShares.view({ token: share.token });
    expect(view.lists.map((l) => l.name)).toEqual(["Wishes"]);
    expect(view.numItems).toBe(1);

    const page = await guest.guestShares.bookmarks({ token: share.token });
    expect(page.bookmarks.map((b) => b.id)).toEqual([shown]);

    // A list that isn't ticked, even one under a ticked one, isn't there.
    await expect(
      guest.guestShares.bookmarks({ token: share.token, listId: under }),
    ).rejects.toThrow(/not found/i);
    await expect(
      guest.guestShares.bookmarks({ token: share.token, listId: secret }),
    ).rejects.toThrow(/not found/i);

    // Ticked too: it's in the tree, under its folder.
    await owner.guestShares.update({ id: share.id, listIds: [wishes, under] });
    const both = await guest.guestShares.view({ token: share.token });
    expect(both.lists.find((l) => l.id === under)?.parentId).toBe(wishes);
    expect(both.numItems).toBe(2);
  });

  test<CustomTestContext>("search stays within the link's lists", async ({
    apiCallers,
    unauthedAPICaller: guest,
  }) => {
    const owner = apiCallers[0];
    const wishes = await list(owner, "Wishes");
    const secret = await list(owner, "Secret");
    const shown = await note(owner, "a lamp", wishes);
    await note(owner, "a surprise", secret);
    const share = await owner.guestShares.create({ listIds: [wishes] });

    const found = await guest.guestShares.search({
      token: share.token,
      text: "",
    });
    expect(found.bookmarks.map((b) => b.id)).toEqual([shown]);
  });

  test<CustomTestContext>("one bookmark only when it's shown, notes when allowed", async ({
    apiCallers,
    unauthedAPICaller: guest,
  }) => {
    const owner = apiCallers[0];
    const wishes = await list(owner, "Wishes");
    const shown = await note(owner, "a lamp", wishes);
    const hidden = await note(owner, "a surprise");
    await owner.bookmarks.updateBookmark({
      bookmarkId: shown,
      note: "in blue",
    });
    const share = await owner.guestShares.create({ listIds: [wishes] });

    const one = await guest.guestShares.bookmark({
      token: share.token,
      bookmarkId: shown,
    });
    expect(one.listIds).toEqual([wishes]);
    expect(one.bookmark.note).toBeNull();
    await expect(
      guest.guestShares.bookmark({ token: share.token, bookmarkId: hidden }),
    ).rejects.toThrow(/not found/i);

    await owner.guestShares.update({ id: share.id, showNotes: true });
    const withNote = await guest.guestShares.bookmark({
      token: share.token,
      bookmarkId: shown,
    });
    expect(withNote.bookmark.note).toBe("in blue");
  });

  test<CustomTestContext>("only your own manual lists can be ticked", async ({
    apiCallers,
  }) => {
    const [owner, other] = apiCallers;
    const theirs = await list(other, "Theirs");
    const smart = await owner.lists.create({
      name: "Smart",
      icon: "✨",
      type: "smart",
      query: "is:fav",
    });
    const mine = await list(owner, "Mine");
    const share = await owner.guestShares.create({
      listIds: [theirs, smart.id, mine],
    });
    expect(share.listIds).toEqual([mine]);

    // Nor can anyone else change your link.
    await expect(
      other.guestShares.update({ id: share.id, listIds: [theirs] }),
    ).rejects.toThrow(/not found/i);
    expect(await other.guestShares.list()).toEqual([]);
  });

  test<CustomTestContext>("a reset or deleted link stops working", async ({
    apiCallers,
    unauthedAPICaller: guest,
  }) => {
    const owner = apiCallers[0];
    const wishes = await list(owner, "Wishes");
    const share = await owner.guestShares.create({ listIds: [wishes] });

    const reset = await owner.guestShares.resetLink({ id: share.id });
    expect(reset.token).not.toBe(share.token);
    await expect(
      guest.guestShares.view({ token: share.token }),
    ).rejects.toThrow(/not found/i);
    await guest.guestShares.view({ token: reset.token });

    await owner.guestShares.delete({ id: share.id });
    await expect(
      guest.guestShares.view({ token: reset.token }),
    ).rejects.toThrow(/not found/i);
  });

  test<CustomTestContext>("a deleted list leaves the link", async ({
    apiCallers,
  }) => {
    const owner = apiCallers[0];
    const wishes = await list(owner, "Wishes");
    const other = await list(owner, "Other");
    const share = await owner.guestShares.create({ listIds: [wishes, other] });
    await owner.lists.delete({ listId: other });
    const [after] = await owner.guestShares.list();
    expect(after.listIds).toEqual([wishes]);
    expect(after.id).toBe(share.id);
  });

  test<CustomTestContext>("files only of bookmarks the guest can see", async ({
    apiCallers,
    db,
  }) => {
    const owner = apiCallers[0];
    const userId = (await owner.users.whoami()).id;
    const wishes = await list(owner, "Wishes");
    const picture = async (name: string) => {
      await db.insert(assets).values({
        id: name,
        assetType: AssetTypes.UNKNOWN,
        contentType: "image/jpeg",
        size: 1000,
        userId,
      });
      const { id } = await owner.bookmarks.createBookmark({
        type: BookmarkTypes.ASSET,
        assetType: "image",
        assetId: name,
      });
      return id;
    };
    const shown = await picture("shown-asset");
    await picture("hidden-asset");
    await owner.lists.addToList({ listId: wishes, bookmarkId: shown });
    const share = await owner.guestShares.create({ listIds: [wishes] });

    const scope = (await guestShareScope(db, share.token))!;
    expect(await guestCanSeeAsset(db, scope, "shown-asset")).toBe(true);
    expect(await guestCanSeeAsset(db, scope, "hidden-asset")).toBe(false);
    expect(await guestCanSeeAsset(db, scope, "no-such-asset")).toBe(false);
  });
});
