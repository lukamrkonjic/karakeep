import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { instagramSessionsTable } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

const SESSION = "123456789%3AAbCdEf%3A12%3AAYh-signature";

/** Instagram, answering every call with `status` and `body`. */
function instagramAnswers(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(
          status === 200 && url.includes("/users/123456789/info/")
            ? { status: "ok", user: { username: "luka" } }
            : body,
        ),
    })),
  );
}

// Fork: connecting Instagram, and subscribing a list to a saved collection.
describe("Instagram", () => {
  beforeEach(() => {
    vi.spyOn(serverConfig, "signingSecret").mockReturnValue("test-secret");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test<CustomTestContext>("connect checks the session, keeps it sealed, and disconnect forgets it", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0].instagram;
    expect(await api.status()).toMatchObject({ connected: false });

    instagramAnswers(200, { status: "ok", items: [] });
    const connected = await api.connect({ session: `sessionid=${SESSION}` });
    expect(connected).toMatchObject({
      connected: true,
      username: "luka",
      status: "ok",
    });
    expect(await api.status()).toMatchObject({
      connected: true,
      username: "luka",
    });

    const me = await apiCallers[0].users.whoami();
    const row = await db.query.instagramSessionsTable.findFirst({
      where: eq(instagramSessionsTable.userId, me.id),
    });
    expect(row?.instagramUserId).toBe("123456789");
    expect(row?.session).not.toContain("AbCdEf");

    await api.disconnect();
    expect(await api.status()).toMatchObject({ connected: false });
  });

  test<CustomTestContext>("a session Instagram turns away isn't kept", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0].instagram;
    await expect(api.connect({ session: "not a session" })).rejects.toThrow(
      /doesn't look like an Instagram session/,
    );
    instagramAnswers(401, { message: "login_required", status: "fail" });
    await expect(api.connect({ session: SESSION })).rejects.toThrow(
      /signed this session out/,
    );
    expect(await api.status()).toMatchObject({ connected: false });
  });

  test<CustomTestContext>("a collection can only be subscribed to with Instagram connected", async ({
    apiCallers,
  }) => {
    const caller = apiCallers[0];
    const list = await caller.lists.create({
      name: "Menswear",
      icon: "",
      type: "manual",
    });
    const link =
      "https://instagram.com/lukamrkonjic/saved/menswear/17904279985007851/?igsh=x";
    await expect(
      caller.listSubscriptions.create({ listId: list.id, url: link }),
    ).rejects.toThrow(/Connect Instagram first/);

    instagramAnswers(200, { status: "ok", items: [] });
    await caller.instagram.connect({ session: SESSION });
    const subscription = await caller.listSubscriptions.create({
      listId: list.id,
      url: link,
    });
    expect(subscription).toMatchObject({
      kind: "instagram",
      url: "https://www.instagram.com/lukamrkonjic/saved/menswear/17904279985007851/",
      name: "menswear",
    });
  });
});
