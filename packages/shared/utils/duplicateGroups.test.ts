import { describe, expect, test } from "vitest";

import { bestDuplicate } from "../types/duplicatePictures";
import { groupDuplicatePairs } from "./duplicateGroups";

const sorted = (groups: { ids: string[]; distance: number }[]) =>
  groups
    .map((g) => ({ ids: [...g.ids].sort(), distance: g.distance }))
    .sort((x, y) => x.ids[0].localeCompare(y.ids[0]));

describe("groupDuplicatePairs", () => {
  test("a chain of pairs is one group, with its least alike pair", () => {
    expect(
      sorted(
        groupDuplicatePairs([
          { a: "a", b: "b", distance: 0.01 },
          { a: "b", b: "c", distance: 0.04 },
          { a: "x", b: "y", distance: 0.02 },
        ]),
      ),
    ).toEqual([
      { ids: ["a", "b", "c"], distance: 0.04 },
      { ids: ["x", "y"], distance: 0.02 },
    ]);
  });

  test("pairs joining two groups make one", () => {
    const groups = groupDuplicatePairs([
      { a: "a", b: "b", distance: 0.01 },
      { a: "c", b: "d", distance: 0.01 },
      { a: "d", b: "a", distance: 0.03 },
    ]);
    expect(sorted(groups)).toEqual([
      { ids: ["a", "b", "c", "d"], distance: 0.03 },
    ]);
  });

  test("no pairs, no groups", () => {
    expect(groupDuplicatePairs([])).toEqual([]);
  });
});

describe("bestDuplicate", () => {
  const at = (day: number) => new Date(2026, 8, day);
  test("keeps the most pixels, then the biggest file, then the first saved", () => {
    expect(
      bestDuplicate([
        { id: "small", width: 800, height: 600, size: 900, createdAt: at(1) },
        { id: "big", width: 2048, height: 1365, size: 500, createdAt: at(2) },
      ]).id,
    ).toBe("big");
    expect(
      bestDuplicate([
        { id: "light", width: 800, height: 600, size: 100, createdAt: at(1) },
        { id: "heavy", width: 800, height: 600, size: 900, createdAt: at(2) },
      ]).id,
    ).toBe("heavy");
    expect(
      bestDuplicate([
        { id: "later", width: 800, height: 600, size: 100, createdAt: at(5) },
        { id: "first", width: 800, height: 600, size: 100, createdAt: at(1) },
      ]).id,
    ).toBe("first");
  });
});
