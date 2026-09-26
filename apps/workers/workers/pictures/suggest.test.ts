import { describe, expect, test } from "vitest";

import { suggestLists } from "./suggest";

// visual ⊃ art; photos stands alone; inbox is where a sync put the picture.
const parents: Record<string, string | null> = {
  visual: null,
  art: "visual",
  photos: null,
  inbox: null,
};
const lists: Record<string, string[]> = {
  m1: ["art", "visual"],
  m2: ["art"],
  m3: ["art"],
  m4: ["photos"],
  m5: ["art", "inbox"],
};
const match = (id: string, similarity = 0.8) => ({ id, similarity });

const suggest = (
  matches: ReturnType<typeof match>[],
  own: string[] = ["inbox"],
  level = { share: 0.4, count: 3 },
) =>
  suggestLists({
    matches,
    listsOf: (id) => lists[id] ?? [],
    own: new Set(own),
    parentOf: (id) => parents[id] ?? null,
    level,
  });

describe("list suggestions", () => {
  test("the list most of the closest matches are in", () => {
    const found = suggest([match("m1"), match("m2"), match("m3"), match("m4")]);
    expect(found.map((s) => s.listId)).toEqual(["art"]);
    expect(found[0].score).toBeCloseTo(0.75);
  });

  test("not a list it's already in, nor one around it", () => {
    expect(
      suggest([match("m1"), match("m2"), match("m3")], ["inbox", "art"]),
    ).toEqual([]);
  });

  test("a list around a suggested one gives way to it", () => {
    // visual gets m1's vote, art gets m1–m3's: only art.
    const found = suggest([match("m1"), match("m2"), match("m3")], ["inbox"], {
      share: 0.2,
      count: 1,
    });
    expect(found.map((s) => s.listId)).toEqual(["art"]);
  });

  test("too few matches for a list: nothing", () => {
    expect(suggest([match("m1"), match("m2"), match("m4")])).toEqual([]);
  });

  test("closer matches weigh more", () => {
    const found = suggest(
      [match("m1", 0.9), match("m2", 0.9), match("m3", 0.9), match("m4", 0.3)],
      ["inbox"],
      { share: 0.85, count: 3 },
    );
    expect(found.map((s) => s.listId)).toEqual(["art"]);
  });
});
