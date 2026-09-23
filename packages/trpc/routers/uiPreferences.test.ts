import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { users } from "@karakeep/db/schema";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

// Fork: the web app's per-account UI preferences.
describe("UI preferences", () => {
  test<CustomTestContext>("merge per key and stay per account", async ({
    apiCallers,
  }) => {
    const mine = apiCallers[0].uiPreferences;
    expect(await mine.get()).toEqual({});

    await mine.update({ gridColumns: 5, tailoredFeedExcluded: ["a", "b"] });
    await mine.update({ pageSorts: { feed: "random" }, gridColumns: 6 });
    expect(await mine.get()).toEqual({
      gridColumns: 6,
      tailoredFeedExcluded: ["a", "b"],
      pageSorts: { feed: "random" },
    });

    // Someone else's are their own.
    expect(await apiCallers[1].uiPreferences.get()).toEqual({});
  });

  test<CustomTestContext>("a stored value in an unknown shape is dropped, not the rest", async ({
    apiCallers,
    db,
  }) => {
    const me = await apiCallers[0].users.whoami();
    await db
      .update(users)
      .set({
        uiPreferences: JSON.stringify({
          gridColumns: 99,
          sidebarCollapsed: true,
          somethingNew: "x",
        }),
      })
      .where(eq(users.id, me.id));
    expect(await apiCallers[0].uiPreferences.get()).toEqual({
      sidebarCollapsed: true,
    });

    await db
      .update(users)
      .set({ uiPreferences: "not json" })
      .where(eq(users.id, me.id));
    expect(await apiCallers[0].uiPreferences.get()).toEqual({});
  });
});
