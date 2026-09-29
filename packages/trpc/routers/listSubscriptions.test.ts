import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  listSubscriptionImportsTable,
  listSubscriptionsTable,
} from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

// Fork: a list subscription's "Whole carousels" checkbox, and forgetting what
// it took.
describe("List subscriptions", () => {
  const board = "https://www.pinterest.com/luka/art/";

  test<CustomTestContext>("whole carousels unless asked for only the first", async ({
    apiCallers,
  }) => {
    const caller = apiCallers[0];
    const list = await caller.lists.create({
      name: "Art",
      icon: "",
      type: "manual",
    });
    const other = await caller.lists.create({
      name: "Other",
      icon: "",
      type: "manual",
    });

    expect(
      await caller.listSubscriptions.create({ listId: list.id, url: board }),
    ).toMatchObject({ wholeCarousel: true, lastStatus: "pending" });
    await caller.listSubscriptions.create({
      listId: other.id,
      url: board,
      wholeCarousel: false,
    });

    const { subscriptions } = await caller.listSubscriptions.list({
      listId: other.id,
    });
    expect(subscriptions).toMatchObject([{ wholeCarousel: false }]);
    expect(subscriptions[0]).not.toHaveProperty("wholeCarouselSince");
    const all = await caller.listSubscriptions.listAll();
    expect(
      all.subscriptions.map((s) => [s.listName, s.wholeCarousel]).sort(),
    ).toEqual([
      ["Art", true],
      ["Other", false],
    ]);
  });

  test<CustomTestContext>("turning it on counts from then; each setting changes alone", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    const list = await caller.lists.create({
      name: "Art",
      icon: "",
      type: "manual",
    });
    const { id } = await caller.listSubscriptions.create({
      listId: list.id,
      url: board,
      wholeCarousel: false,
    });
    const since = async () =>
      (
        await db.query.listSubscriptionsTable.findFirst({
          where: eq(listSubscriptionsTable.id, id),
        })
      )?.wholeCarouselSince;
    expect(await since()).toBeNull();

    const before = Math.floor(Date.now() / 1000) * 1000;
    expect(
      await caller.listSubscriptions.update({
        subscriptionId: id,
        wholeCarousel: true,
      }),
    ).toMatchObject({ wholeCarousel: true, enabled: true });
    const turnedOn = await since();
    expect(turnedOn?.getTime()).toBeGreaterThanOrEqual(before);

    // Already on: it keeps counting from the first time.
    await db
      .update(listSubscriptionsTable)
      .set({ wholeCarouselSince: new Date(1_000_000_000_000) })
      .where(eq(listSubscriptionsTable.id, id));
    await caller.listSubscriptions.update({
      subscriptionId: id,
      wholeCarousel: true,
    });
    expect(await since()).toEqual(new Date(1_000_000_000_000));

    // Pausing leaves it alone, and it leaves pausing alone.
    expect(
      await caller.listSubscriptions.update({
        subscriptionId: id,
        enabled: false,
      }),
    ).toMatchObject({ enabled: false, wholeCarousel: true });
    expect(
      await caller.listSubscriptions.update({
        subscriptionId: id,
        wholeCarousel: false,
      }),
    ).toMatchObject({ enabled: false, wholeCarousel: false });
    expect(await since()).toBeNull();
  });

  test<CustomTestContext>("only your own subscriptions can be changed", async ({
    apiCallers,
  }) => {
    const list = await apiCallers[0].lists.create({
      name: "Art",
      icon: "",
      type: "manual",
    });
    const { id } = await apiCallers[0].listSubscriptions.create({
      listId: list.id,
      url: board,
    });
    await expect(
      apiCallers[1].listSubscriptions.update({
        subscriptionId: id,
        wholeCarousel: false,
      }),
    ).rejects.toThrow(/Subscription not found/);
  });

  test<CustomTestContext>("forgetting what it took: kept pictures detached, the rest dropped", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    const userId = (await caller.users.whoami()).id;
    const list = await caller.lists.create({
      name: "Art",
      icon: "",
      type: "manual",
    });
    const { id } = await caller.listSubscriptions.create({
      listId: list.id,
      url: board,
    });
    const other = await caller.listSubscriptions.create({
      listId: list.id,
      url: "https://www.pinterest.com/luka/food/",
    });
    // Its first sync is done.
    await db
      .update(listSubscriptionsTable)
      .set({ lastStatus: "success" })
      .where(eq(listSubscriptionsTable.id, id));
    const kept = await caller.bookmarks.createBookmark({
      type: BookmarkTypes.TEXT,
      text: "a picture still here",
    });
    await db.insert(listSubscriptionImportsTable).values([
      { userId, subscriptionId: id, externalId: "1", bookmarkId: kept.id },
      // Its picture was deleted, or it was skipped for good.
      { userId, subscriptionId: id, externalId: "2", bookmarkId: null },
      { userId, subscriptionId: other.id, externalId: "3", bookmarkId: null },
    ]);
    // The router's (mocked) one: testUtils mocks shared-server once it's
    // loaded, after this file's own imports.
    const queued = vi.mocked(
      (await import("@karakeep/shared-server")).queueSubscriptionSync,
    );
    queued.mockClear();

    expect(
      await caller.listSubscriptions.forget({ subscriptionId: id }),
    ).toEqual({ forgotten: 2 });
    const rows = await db.select().from(listSubscriptionImportsTable);
    expect(
      rows.map((r) => [r.externalId, r.subscriptionId, r.bookmarkId]).sort(),
    ).toEqual([
      ["1", null, kept.id],
      ["3", other.id, null],
    ]);
    expect(queued).toHaveBeenCalledTimes(1);
    expect(queued.mock.calls[0][1]).toMatchObject({ id });

    // Not while it syncs; a paused one forgets without syncing.
    await db
      .update(listSubscriptionsTable)
      .set({ lastStatus: "pending" })
      .where(eq(listSubscriptionsTable.id, id));
    await expect(
      caller.listSubscriptions.forget({ subscriptionId: id }),
    ).rejects.toThrow(/syncing/);
    await caller.listSubscriptions.update({
      subscriptionId: id,
      enabled: false,
    });
    queued.mockClear();
    expect(
      await caller.listSubscriptions.forget({ subscriptionId: id }),
    ).toEqual({ forgotten: 0 });
    expect(queued).not.toHaveBeenCalled();

    await expect(
      apiCallers[1].listSubscriptions.forget({ subscriptionId: other.id }),
    ).rejects.toThrow(/Subscription not found/);
  });
});
