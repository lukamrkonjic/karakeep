import { describe, expect, test } from "vitest";

import {
  alikePairs,
  bufferToVector,
  buildPictureIndex,
  orderedPair,
  pictureDistance,
  rankPictures,
  vectorToBuffer,
} from "./pictureVectors";

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

describe("ranking pictures", () => {
  const index = buildPictureIndex([
    at("a", 0),
    at("b", 20),
    at("c", 40),
    at("d", 90),
  ]);

  test("most alike first, down to the minimum", () => {
    // cos 20° ≈ 0.94, cos 40° ≈ 0.77, cos 90° = 0.
    const ranked = rankPictures(index, at("q", 5).vector, {
      minSimilarity: 0.5,
    });
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(ranked[0].similarity).toBeCloseTo(Math.cos((5 * Math.PI) / 180));
  });

  test("leaves out, keeps only, and stops at the limit", () => {
    const query = at("q", 0).vector;
    expect(
      rankPictures(index, query, {
        minSimilarity: -1,
        exclude: new Set(["a"]),
        only: (id) => id !== "c",
        limit: 1,
      }).map((r) => r.id),
    ).toEqual(["b"]);
  });

  test("an embedding of another size matches nothing", () => {
    expect(
      rankPictures(index, Float32Array.from([1, 0, 0]), { minSimilarity: -1 }),
    ).toEqual([]);
  });
});
