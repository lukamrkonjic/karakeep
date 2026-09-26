import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { listSubscriptionsTable } from "@karakeep/db/schema";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

// Fork: a list subscription's "Whole carousels" checkbox.
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
});
