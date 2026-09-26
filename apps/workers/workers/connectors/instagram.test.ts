import { beforeEach, describe, expect, test, vi } from "vitest";

import type { IgMedia } from "./instagram";
import { wantedBy } from "./ledger";

// The API is called through the workers' fetchWithProxy: pages come from here.
const pages: Record<string, unknown>[] = [];
const requested: string[] = [];
vi.mock("network", () => ({
  fetchWithProxy: vi.fn(async (url: string) => {
    requested.push(url);
    const body = pages.shift() ?? { status: "ok", items: [] };
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  }),
}));

const { fetchInstagramCollection, itemsOfPost } = await import("./instagram");

const cdn = (name: string) => `https://scontent.cdninstagram.com/v/${name}`;
const picture = (name: string): IgMedia => ({
  image_versions2: {
    candidates: [
      { url: cdn(`${name}_640.jpg`), width: 640 },
      { url: cdn(`${name}_1080.jpg`), width: 1080 },
    ],
  },
});

describe("Instagram posts", () => {
  test("a picture: its widest version, named by the caption", () => {
    const items = itemsOfPost({
      code: "ABC",
      caption: { text: "\nSpaghetti al mare\nsecond line" },
      ...picture("a"),
    });
    expect(items).toEqual([
      {
        externalId: "ABC",
        mediaKey: "ig:ABC",
        title: "Spaghetti al mare",
        sourceUrl: "https://www.instagram.com/p/ABC/",
        media: [{ kind: "image", url: cdn("a_1080.jpg") }],
      },
    ]);
  });

  test("a reel: its widest mp4 first, then the cover", () => {
    const [item] = itemsOfPost({
      code: "REEL1",
      product_type: "clips",
      user: { username: "someone" },
      video_versions: [
        { url: cdn("v_480.mp4"), width: 480 },
        { url: cdn("v_720.mp4"), width: 720 },
        { url: "https://evil.example.com/v.mp4", width: 1080 },
      ],
      ...picture("cover"),
    });
    expect(item.sourceUrl).toBe("https://www.instagram.com/reel/REEL1/");
    expect(item.title).toBe("@someone");
    expect(item.media).toEqual([
      { kind: "video", url: cdn("v_720.mp4") },
      { kind: "video", url: cdn("v_480.mp4") },
      { kind: "image", url: cdn("cover_1080.jpg") },
    ]);
  });

  test("a carousel: every picture and video, each pointing at its slide", () => {
    const items = itemsOfPost({
      code: "CAR",
      carousel_media: [
        picture("one"),
        { video_versions: [{ url: cdn("two.mp4"), width: 720 }] },
        {},
        picture("four"),
      ],
    });
    expect(
      items.map((i) => [i.externalId, i.sourceUrl, i.media[0].kind, i.partOf]),
    ).toEqual([
      [
        "CAR_1",
        "https://www.instagram.com/p/CAR/?img_index=1",
        "image",
        undefined,
      ],
      [
        "CAR_2",
        "https://www.instagram.com/p/CAR/?img_index=2",
        "video",
        "CAR_1",
      ],
      [
        "CAR_4",
        "https://www.instagram.com/p/CAR/?img_index=4",
        "image",
        "CAR_1",
      ],
    ]);
  });

  test("a carousel whose first slide has nothing: the next one is first", () => {
    const items = itemsOfPost({
      code: "CAR",
      carousel_media: [{}, picture("two"), picture("three")],
    });
    expect(items.map((i) => [i.externalId, i.partOf])).toEqual([
      ["CAR_2", undefined],
      ["CAR_3", "CAR_2"],
    ]);
  });
});

describe("Instagram collections", () => {
  beforeEach(() => {
    pages.length = 0;
    requested.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });

  const session = { sessionid: "123%3Aabc%3A1%3Asig" };
  const page = (codes: string[], next: string | null) => ({
    status: "ok",
    items: codes.map((code) => ({ media: { code, ...picture(code) } })),
    more_available: next !== null,
    next_max_id: next,
  });

  test("pages to the end the first time", async () => {
    pages.push(page(["N3", "N2"], "c1"), page(["N1"], null));
    const reading = fetchInstagramCollection(
      "https://www.instagram.com/me/saved/menswear/179/",
      session,
    );
    await vi.runAllTimersAsync();
    const result = await reading;
    expect(result.items.map((i) => i.externalId)).toEqual(["N3", "N2", "N1"]);
    expect(result).toMatchObject({ name: "menswear", complete: true });
    expect(requested).toEqual([
      "https://www.instagram.com/api/v1/feed/collection/179/posts/",
      "https://www.instagram.com/api/v1/feed/collection/179/posts/?max_id=c1",
    ]);
  });

  test("stops at the first page with nothing new", async () => {
    pages.push(
      page(["NEW", "OLD1"], "c1"),
      page(["OLD2", "OLD3"], "c2"),
      page(["OLD4"], null),
    );
    const known = new Set(["OLD1", "OLD2", "OLD3", "OLD4"]);
    const reading = fetchInstagramCollection(
      "https://www.instagram.com/me/saved/all-posts/",
      session,
      { isKnown: (item) => known.has(item.externalId) },
    );
    await vi.runAllTimersAsync();
    const result = await reading;
    expect(requested).toHaveLength(2);
    expect(requested[0]).toBe(
      "https://www.instagram.com/api/v1/feed/saved/posts/",
    );
    expect(result.items.map((i) => i.externalId)).toEqual([
      "NEW",
      "OLD1",
      "OLD2",
      "OLD3",
    ]);
    expect(result).toMatchObject({ name: "All posts", complete: false });
  });

  test("with only the first taken, the rest of a carousel counts as known", async () => {
    const carousel = (code: string) => ({
      media: { code, carousel_media: [picture("a"), picture("b")] },
    });
    const pageOf = (codes: string[], next: string | null) => ({
      status: "ok",
      items: codes.map(carousel),
      more_available: next !== null,
      next_max_id: next,
    });
    pages.push(
      pageOf(["NEW", "OLD1"], "c1"),
      pageOf(["OLD2"], "c2"),
      pageOf(["OLD3"], null),
    );
    const handled = new Map(
      ["OLD1_1", "OLD2_1", "OLD3_1"].map((id) => [id, new Date()]),
    );
    const wanted = wantedBy(handled, null);
    const reading = fetchInstagramCollection(
      "https://www.instagram.com/me/saved/all-posts/",
      session,
      { isKnown: (item) => !wanted(item) },
    );
    await vi.runAllTimersAsync();
    const result = await reading;
    expect(requested).toHaveLength(2);
    expect(result.items.filter(wanted).map((i) => i.externalId)).toEqual([
      "NEW_1",
    ]);
  });
});
