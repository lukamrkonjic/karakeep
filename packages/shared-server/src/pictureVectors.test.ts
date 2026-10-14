import { describe, expect, test } from "vitest";

import {
  alikePairs,
  bufferToVector,
  buildPictureIndex,
  orderedPair,
  pictureDistance,
  rankPictures,
  sameKind,
  standOutCutoff,
  sameLength,
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

describe("videos", () => {
  test("the same video only if as long", () => {
    expect(sameLength(30, 30.4)).toBe(true);
    expect(sameLength(30, 31.5)).toBe(false);
    expect(sameLength(600, 615)).toBe(true); // 3% of a long one
    expect(sameLength(0, 0)).toBe(false); // couldn't be measured
    const picture = { video: false, duration: null };
    const video = (duration: number | null) => ({ video: true, duration });
    expect(sameKind(picture, picture)).toBe(true);
    expect(sameKind(picture, video(12))).toBe(false);
    expect(sameKind(video(12), video(12.5))).toBe(true);
    expect(sameKind(video(12), video(20))).toBe(false);
    expect(sameKind(video(null), video(12))).toBe(false);
  });
});

describe("what stands out for a description", () => {
  // Pictures evenly from `from` to `to` alike.
  const spread = (n: number, from: number, to: number) =>
    Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  const standOut = { spreads: 3, nearBest: 0.06 };

  test("far above the rest's spread, or near the best", () => {
    // The rest round 0.19 (a robust deviation of 1.4826 × 0.02): standing
    // out starts at 0.28 — but rings at 0.32 keep those down to 0.26.
    const rest = spread(301, 0.15, 0.23);
    expect(standOutCutoff([...rest, 0.3, 0.32], standOut)).toBeCloseTo(0.26);
    expect(standOutCutoff([...rest, 0.36], standOut)).toBeCloseTo(
      0.19 + 3 * 1.4826 * 0.02,
      2,
    );
    // A subject much of the library shows keeps its pictures.
    expect(
      standOutCutoff(
        [...spread(180, 0.15, 0.21), ...spread(120, 0.24, 0.3)],
        standOut,
      ),
    ).toBeCloseTo(0.24);
    // Too few pictures to tell.
    expect(standOutCutoff(spread(50, 0.1, 0.3), standOut)).toBeNull();
  });

  test("ranked: only what stands out, over the floor", () => {
    const like = (id: string, similarity: number) =>
      at(id, (Math.acos(similarity) * 180) / Math.PI);
    const index = buildPictureIndex([
      ...spread(200, 0.15, 0.23).map((s, i) => like(`rest ${i}`, s)),
      like("round", 0.24),
      like("ring", 0.3),
      like("best ring", 0.32),
    ]);
    const word = Float32Array.from([1, 0]);
    const ids = (opts: Parameters<typeof rankPictures>[2]) =>
      rankPictures(index, word, opts).map((r) => r.id);
    expect(ids({ minSimilarity: 0.235 })).toEqual([
      "best ring",
      "ring",
      "round",
    ]);
    expect(ids({ minSimilarity: 0.235, standOut })).toEqual([
      "best ring",
      "ring",
    ]);
  });
});
