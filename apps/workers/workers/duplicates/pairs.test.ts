import { describe, expect, test } from "vitest";

import {
  alikePairs,
  bufferToVector,
  orderedPair,
  pictureDistance,
  vectorToBuffer,
} from "./pairs";

// Unit vectors at an angle: cos(angle) apart, so distance = 1 - cos(angle).
const at = (id: string, degrees: number) => {
  const r = (degrees * Math.PI) / 180;
  return { id, vector: Float32Array.from([Math.cos(r), Math.sin(r)]) };
};

describe("duplicate picture pairs", () => {
  test("distance is 0 for the same direction, 1 at right angles", () => {
    expect(pictureDistance(at("a", 10).vector, at("b", 10).vector)).toBeCloseTo(
      0,
    );
    expect(pictureDistance(at("a", 0).vector, at("b", 90).vector)).toBeCloseTo(
      1,
    );
  });

  test("finds each alike pair once, among the new and against the known", () => {
    // 5° apart ≈ 0.0038; 30° ≈ 0.134.
    const known = [at("k1", 0), at("k2", 100)];
    const fresh = [at("f1", 3), at("f2", 8), at("f3", 60)];
    const pairs = alikePairs(fresh, known, 0.02)
      .map(
        (p) => `${orderedPair(p).bookmarkId}-${orderedPair(p).otherBookmarkId}`,
      )
      .sort();
    expect(pairs).toEqual(["f1-f2", "f1-k1", "f2-k1"]);
  });

  test("known pictures aren't compared with each other again", () => {
    const known = [at("k1", 0), at("k2", 1)];
    expect(alikePairs([], known, 0.02)).toEqual([]);
  });

  test("an embedding survives being stored", () => {
    const vector = Float32Array.from([0.25, -0.5, 0.125]);
    expect(bufferToVector(vectorToBuffer(vector))).toEqual(vector);
  });
});
