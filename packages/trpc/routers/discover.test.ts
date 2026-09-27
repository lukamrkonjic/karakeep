import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { discoverItemsTable } from "@karakeep/db/schema";
import { vectorToBuffer } from "@karakeep/shared-server";

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

/** A picture waiting on the Discover page. */
async function waiting(
  api: Api,
  db: DB,
  pinId: string,
  opts: {
    score?: number;
    degrees?: number;
    suggestedListId?: string;
    status?: "new" | "skipped";
  } = {},
) {
  const userId = (await api.users.whoami()).id;
  const [row] = await db
    .insert(discoverItemsTable)
    .values({
      userId,
      pinId,
      title: `pin ${pinId}`,
      thumbUrl: `https://i.pinimg.com/474x/${pinId}.jpg`,
      width: 474,
      height: 600,
      media: [
        { kind: "image", url: `https://i.pinimg.com/originals/${pinId}.jpg` },
      ],
      embedding: vectorToBuffer(at(opts.degrees ?? 0)),
      score: opts.score ?? 0.5,
      suggestedListId: opts.suggestedListId,
      status: opts.status ?? "new",
    })
    .returning();
  return row.id;
}

// Fork: Discover — new pictures from Pinterest, kept or skipped.
describe("Discover", () => {
  test<CustomTestContext>("what's waiting, the best first; Keep files it in a list", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const userId = (await api.users.whoami()).id;
    const sofas = await api.lists.create({
      name: "Sofas",
      icon: "🛋️",
      type: "manual",
    });
    const cars = await api.lists.create({
      name: "Cars",
      icon: "🚗",
      type: "manual",
    });
    const best = await waiting(api, db, "1", {
      score: 0.9,
      suggestedListId: sofas.id,
    });
    const other = await waiting(api, db, "2", { score: 0.5 });
    await waiting(api, db, "3", { score: 0.7, status: "skipped" });

    const { items } = await api.discover.items();
    expect(items.map((i) => i.id)).toEqual([best, other]);
    expect(items[0]).toMatchObject({
      pinUrl: "https://www.pinterest.com/pin/1/",
      suggestedList: { id: sofas.id, name: "Sofas", icon: "🛋️" },
      status: "new",
    });
    expect(items[1].suggestedList).toBeNull();

    const server = await import("@karakeep/shared-server");
    const queued = vi.mocked(server.queueDiscoverKeep);
    queued.mockClear();
    // Into the suggested list, left to the workers.
    await api.discover.keep({ itemId: best });
    expect(queued).toHaveBeenCalledWith(best, userId);
    const kept = await db.query.discoverItemsTable.findFirst({
      where: eq(discoverItemsTable.id, best),
    });
    expect(kept).toMatchObject({ status: "keeping", listId: sofas.id });
    await expect(api.discover.keep({ itemId: best })).rejects.toThrow(
      /kept or skipped already/,
    );
    expect((await api.discover.items()).items.map((i) => i.id)).toEqual([
      other,
    ]);

    // Into another list — one of your own, and not a smart one.
    const smart = await api.lists.create({
      name: "Smart",
      icon: "✨",
      type: "smart",
      query: "#sofa",
    });
    await expect(
      api.discover.keep({ itemId: other, listId: smart.id }),
    ).rejects.toThrow(/smart list/);
    const theirs = await apiCallers[1].lists.create({
      name: "Theirs",
      icon: "🔒",
      type: "manual",
    });
    await expect(
      api.discover.keep({ itemId: other, listId: theirs.id }),
    ).rejects.toThrow();
    await expect(
      apiCallers[1].discover.keep({ itemId: other }),
    ).rejects.toThrow(/Not found/);
    await api.discover.keep({ itemId: other, listId: cars.id });
    expect(
      (
        await db.query.discoverItemsTable.findFirst({
          where: eq(discoverItemsTable.id, other),
        })
      )?.listId,
    ).toBe(cars.id);
  });

  test<CustomTestContext>("Skip: gone for good, with the ones like it; undone", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const skipped = await waiting(api, db, "10", { degrees: 0, score: 0.9 });
    const alike = await waiting(api, db, "11", { degrees: 5, score: 0.8 });
    const different = await waiting(api, db, "12", {
      degrees: 60,
      score: 0.7,
    });

    expect(await api.discover.skip({ itemId: skipped })).toEqual({
      alongWith: 1,
    });
    expect((await api.discover.items()).items.map((i) => i.id)).toEqual([
      different,
    ]);
    expect(
      await db.query.discoverItemsTable.findFirst({
        where: eq(discoverItemsTable.id, alike),
      }),
    ).toBeUndefined();

    await api.discover.restore({ itemId: skipped });
    expect((await api.discover.items()).items.map((i) => i.id)).toEqual([
      skipped,
      different,
    ]);
    await expect(
      apiCallers[1].discover.skip({ itemId: different }),
    ).rejects.toThrow(/Not found/);
  });

  test<CustomTestContext>("Look for more asks the workers", async ({
    apiCallers,
  }) => {
    const server = await import("@karakeep/shared-server");
    const requested = vi.mocked(server.requestDiscover);
    requested.mockClear();
    await apiCallers[0].discover.refresh();
    expect(requested).toHaveBeenCalledTimes(1);
  });
});
