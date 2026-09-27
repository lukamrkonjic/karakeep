import { describe, expect, test } from "vitest";

import { pickDiscoveries, tasteKinds } from "./discover";

const unit = (...values: number[]) => {
  const length = Math.hypot(...values);
  return Float32Array.from(values, (v) => v / length);
};

/** A seeded random source, so the tests are the same every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Discover's picking", () => {
  test("a taste of two kinds gives two kinds", () => {
    const cars = [unit(1, 0.05, 0), unit(1, -0.05, 0), unit(1, 0, 0.05)];
    const sofas = [unit(0, 1, 0.05), unit(0.05, 1, 0), unit(0, 1, -0.05)];
    const kinds = tasteKinds([...cars, ...sofas], 2, seeded(1));
    expect(kinds).toHaveLength(2);
    const near = (a: Float32Array, b: Float32Array) =>
      a.reduce((sum, v, i) => sum + v * b[i], 0) > 0.99;
    expect(kinds.some((k) => near(k, unit(1, 0, 0)))).toBe(true);
    expect(kinds.some((k) => near(k, unit(0, 1, 0)))).toBe(true);
  });

  test("the pictures most like the taste, a few wildcards among them", () => {
    // In 32 dimensions: each "like" shares the taste's direction plus one of
    // its own, so none is a near-copy of another; each "unlike" is its own.
    const axis = (...weights: [number, number][]) => {
      const values = Array.from({ length: 32 }, () => 0);
      for (const [i, w] of weights) {
        values[i] = w;
      }
      return unit(...values);
    };
    const taste = [axis([0, 1]), axis([0, 1], [31, 0.1])];
    const like = Array.from({ length: 10 }, (_, i) => ({
      id: `like${i}`,
      vector: axis([0, 1], [i + 1, 0.8]),
    }));
    const unlike = Array.from({ length: 10 }, (_, i) => ({
      id: `unlike${i}`,
      vector: axis([i + 15, 1]),
    }));
    const set = pickDiscoveries({
      candidates: [...unlike, ...like],
      taste,
      count: 8,
      wildcards: 2,
      random: seeded(2),
    });
    expect(set).toHaveLength(8);
    expect(new Set(set).size).toBe(8);
    // Six chosen by taste, all from the ones like it.
    expect(
      set.filter((id) => id.startsWith("like")).length,
    ).toBeGreaterThanOrEqual(6);
  });

  test("never two near-identical pictures", () => {
    const set = pickDiscoveries({
      candidates: [
        { id: "a", vector: unit(1, 0, 0) },
        { id: "a-copy", vector: unit(1, 0.01, 0) },
        { id: "b", vector: unit(0, 1, 0) },
      ],
      taste: [unit(1, 0, 0)],
      count: 3,
      wildcards: 0,
      random: seeded(3),
    });
    expect(set).toHaveLength(2);
    expect(set.filter((id) => id.startsWith("a"))).toHaveLength(1);
  });

  test("with no taste yet, a mix of anything", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      vector: unit(Math.cos(i), Math.sin(i), 0),
    }));
    const set = pickDiscoveries({
      candidates,
      taste: [],
      count: 3,
      wildcards: 1,
      random: seeded(4),
    });
    expect(set).toHaveLength(3);
  });
});

describe("Discover's shuffles", () => {
  test("those not shown lately first; the shown ones only fill up", () => {
    const unitAt = (degrees: number) => {
      const r = (degrees * Math.PI) / 180;
      return Float32Array.from([Math.cos(r), Math.sin(r), 0]);
    };
    // Four far apart; the best two for the taste were just shown.
    const candidates = [
      { id: "shown-best", vector: unitAt(0), bonus: 0 },
      { id: "shown-next", vector: unitAt(90), bonus: 0 },
      { id: "fresh-a", vector: unitAt(180), bonus: 1 },
      { id: "fresh-b", vector: unitAt(270), bonus: 1 },
    ];
    const set = pickDiscoveries({
      candidates,
      taste: [unitAt(0)],
      count: 2,
      wildcards: 0,
    });
    expect(set.sort()).toEqual(["fresh-a", "fresh-b"]);
  });
});
