import { describe, expect, test } from "vitest";

import type { SubscriptionItem } from "./types";
import { wantedBy } from "./ledger";

const item = (externalId: string, partOf?: string): SubscriptionItem => ({
  externalId,
  mediaKey: null,
  title: null,
  sourceUrl: `https://example.com/${externalId}`,
  media: [{ kind: "image", url: `https://example.com/${externalId}.jpg` }],
  partOf,
});

// A carousel post of three pictures, and a post of one.
const post = [item("P_1"), item("P_2", "P_1"), item("P_3", "P_1")];
const single = item("S");
const ids = (wanted: (i: SubscriptionItem) => boolean) =>
  [...post, single].filter(wanted).map((i) => i.externalId);

const monday = new Date("2026-09-21T10:00:00Z");
const tuesday = new Date("2026-09-22T10:00:00Z");

describe("what a sync takes", () => {
  test("whole carousels: every picture of a new post", () => {
    expect(ids(wantedBy(new Map(), monday))).toEqual([
      "P_1",
      "P_2",
      "P_3",
      "S",
    ]);
  });

  test("only the first: the rest of a carousel never", () => {
    expect(ids(wantedBy(new Map(), null))).toEqual(["P_1", "S"]);
    expect(ids(wantedBy(new Map([["P_1", monday]]), null))).toEqual(["S"]);
  });

  test("nothing handled is taken again", () => {
    const handled = new Map([
      ["P_1", tuesday],
      ["P_3", tuesday],
      ["S", tuesday],
    ]);
    // P_2 failed last time: it's tried again.
    expect(ids(wantedBy(handled, monday))).toEqual(["P_2"]);
  });

  test("turned on later: posts taken before keep what they have", () => {
    const handled = new Map([["P_1", monday]]);
    expect(ids(wantedBy(handled, tuesday))).toEqual(["S"]);
  });
});
