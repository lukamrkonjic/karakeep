import { describe, expect, test } from "vitest";

import { buildPictureIndex } from "@karakeep/shared-server";

import { rankCandidates } from "./discover";

// Fingerprints as unit vectors in 3D: distance = 1 - their dot product.
const unit = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  return Float32Array.from([x / length, y / length, z / length]);
};
/** A vector `distance` from `from`, turned towards the unit vector `to`. */
const away = (from: Float32Array, distance: number, to: Float32Array) => {
  const angle = Math.acos(1 - distance);
  return unit(
    ...([0, 1, 2].map(
      (i) => Math.cos(angle) * from[i] + Math.sin(angle) * to[i],
    ) as [number, number, number]),
  );
};

const sofas = [
  { id: "sofa1", vector: unit(1, 0, 0) },
  { id: "sofa2", vector: unit(0.99, 0.1, 0) },
  { id: "sofa3", vector: unit(0.99, 0, 0.1) },
];
const lists = new Map<string, string[]>([
  ["sofa1", ["sofas"]],
  ["sofa2", ["sofas"]],
  ["sofa3", ["sofas"]],
  ["car", ["cars"]],
]);

function rank(
  library: { id: string; vector: Float32Array }[],
  candidates: Record<string, Float32Array>,
  skipped: Float32Array[] = [],
) {
  return rankCandidates({
    candidates: Object.entries(candidates).map(([key, vector]) => ({
      key,
      vector,
    })),
    library: buildPictureIndex(library),
    skipped,
    listsOf: (id) => lists.get(id) ?? [],
    parentOf: () => null,
  });
}

describe("Discover's ranking", () => {
  const withCar = [...sofas, { id: "car", vector: unit(0, 1, 0) }];

  test("the most like the user's pictures first, with their list", () => {
    const ranked = rank(withCar, {
      far: unit(0, 0.3, 1),
      sofaish: unit(0.8, 0.6, 0),
    });
    expect(ranked.map((r) => r.key)).toEqual(["sofaish", "far"]);
    expect(ranked[0].suggestedListId).toBe("sofas");
    expect(ranked[1].suggestedListId).toBeNull();
  });

  test("one the user already has is left out", () => {
    expect(rank(withCar, { copy: unit(1, 0.05, 0) })).toEqual([]);
  });

  test("a skipped kind stays away, and pulls near ones down", () => {
    const a = unit(0.8, 0.6, 0);
    const b = unit(0.78, 0, 0.6);
    expect(rank(sofas, { a, b }).map((r) => r.key)).toEqual(["a", "b"]);
    // Like a skipped one: gone.
    expect(
      rank(sofas, { a, b }, [away(b, 0.1, unit(0, 1, 0))]).map((r) => r.key),
    ).toEqual(["a"]);
    // Near a skipped one: below the other.
    expect(
      rank(sofas, { a, b }, [away(a, 0.2, unit(0, 0, -1))]).map((r) => r.key),
    ).toEqual(["b", "a"]);
  });

  test("the same picture twice counts once", () => {
    const ranked = rank(sofas, {
      one: unit(0.8, 0.6, 0),
      again: unit(0.8, 0.61, 0),
    });
    expect(ranked).toHaveLength(1);
  });
});
