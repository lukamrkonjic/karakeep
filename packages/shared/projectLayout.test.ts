import { describe, expect, test } from "vitest";

import type { Rect, TidyItem } from "./projectLayout";
import {
  atWidth,
  blockColumns,
  boundsOf,
  DEFAULT_ASPECT,
  fitView,
  GAP,
  intersects,
  masonry,
  PICTURE_WIDTH,
  placeNew,
  readingOrder,
  tidy,
} from "./projectLayout";

const noOverlaps = (rects: Rect[]) => {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(intersects(rects[i], rects[j])).toBe(false);
    }
  }
};

describe("projectLayout", () => {
  test("boundsOf", () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 10, y: 20, w: 100, h: 50 },
        { x: -40, y: 60, w: 20, h: 100 },
      ]),
    ).toEqual({ x: -40, y: 20, w: 150, h: 140 });
  });

  test("atWidth keeps the shape, or guesses one", () => {
    expect(atWidth({ w: 400, h: 200 }, 100)).toEqual({ w: 100, h: 50 });
    expect(atWidth({ w: 0, h: 0 }, 100)).toEqual({
      w: 100,
      h: 100 * DEFAULT_ASPECT,
    });
  });

  test("blockColumns: about square", () => {
    expect(blockColumns(1)).toBe(1);
    expect(blockColumns(2)).toBe(2);
    expect(blockColumns(9)).toBe(4);
    expect(blockColumns(1000)).toBe(8);
  });

  test("masonry fills the shortest column, left first", () => {
    const { rects, w, h } = masonry(
      [
        { w: 100, h: 200 },
        { w: 100, h: 100 },
        { w: 100, h: 100 },
      ],
      2,
      100,
    );
    expect(rects).toEqual([
      { x: 0, y: 0, w: 100, h: 200 },
      { x: 100 + GAP, y: 0, w: 100, h: 100 },
      { x: 100 + GAP, y: 100 + GAP, w: 100, h: 100 },
    ]);
    expect(w).toBe(200 + GAP);
    expect(h).toBe(100 + GAP + 100);
    noOverlaps(rects);
  });

  test("placeNew: centred on a drop", () => {
    const [only] = placeNew([], [{ w: 100, h: 100 }], { x: 500, y: 500 });
    expect(only).toEqual({
      x: 500 - PICTURE_WIDTH / 2,
      y: 500 - PICTURE_WIDTH / 2,
      w: PICTURE_WIDTH,
      h: PICTURE_WIDTH,
    });
  });

  test("placeNew: right of what's there, never over it", () => {
    const existing = [
      { x: 0, y: 0, w: 300, h: 300 },
      { x: 0, y: 400, w: 300, h: 300 },
    ];
    const placed = placeNew(
      existing,
      Array.from({ length: 7 }, () => ({ w: 300, h: 400 })),
    );
    expect(placed).toHaveLength(7);
    expect(Math.min(...placed.map((r) => r.y))).toBe(0);
    for (const r of placed) {
      expect(r.x).toBeGreaterThan(300);
      expect(r.w).toBe(PICTURE_WIDTH);
      expect(r.h).toBe(320);
    }
    noOverlaps([...existing, ...placed]);
  });

  test("readingOrder: rows top to bottom, left to right", () => {
    const items = [
      { id: "b", x: 300, y: 10, w: 100, h: 100 },
      { id: "c", x: 0, y: 300, w: 100, h: 100 },
      { id: "a", x: 0, y: 0, w: 100, h: 100 },
    ];
    expect(readingOrder(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  test("tidy: one width, reading order, headings start groups", () => {
    const items: TidyItem[] = [
      { id: "title", x: 0, y: -100, w: 500, h: 40, heading: true },
      { id: "p1", x: 0, y: 0, w: 200, h: 100, keepsShape: true },
      { id: "p2", x: 900, y: 10, w: 400, h: 400, keepsShape: true },
      { id: "p3", x: 50, y: 700, w: 200, h: 300, keepsShape: true },
      { id: "section", x: 0, y: 1500, w: 300, h: 30, heading: true },
      { id: "p4", x: 0, y: 1600, w: 200, h: 200, keepsShape: true },
    ];
    const out = tidy(items);
    const get = (id: string) => out.get(id)!;
    // Starts where they started.
    expect(get("title")).toEqual({ x: 0, y: -100, w: 500, h: 40 });
    // The median picture width, the shape kept.
    expect(get("p1")).toMatchObject({ y: -100 + 40 + GAP, w: 200, h: 100 });
    expect(get("p2").w).toBe(200);
    expect(get("p2").h).toBe(200);
    // The section heading is under all of the first group.
    const firstGroup = ["p1", "p2", "p3"].map(get);
    const bottom = Math.max(...firstGroup.map((r) => r.y + r.h));
    expect(get("section").y).toBe(bottom + GAP * 3);
    expect(get("p4").y).toBe(get("section").y + 30 + GAP);
    noOverlaps([...out.values()]);
  });

  test("tidy: two headings in a row sit one under the other", () => {
    const out = tidy([
      { id: "h1", x: 0, y: 0, w: 100, h: 20, heading: true },
      { id: "h2", x: 0, y: 50, w: 100, h: 20, heading: true },
    ]);
    expect(out.get("h2")!.y).toBe(20 + GAP);
  });

  test("fitView: the whole of it, centred, never above 100%", () => {
    const view = fitView({ x: 0, y: 0, w: 1000, h: 500 }, { w: 600, h: 600 });
    expect(view.scale).toBeCloseTo((600 - 96) / 1000);
    expect(view.x + 500 * view.scale).toBeCloseTo(300);
    expect(view.y + 250 * view.scale).toBeCloseTo(300);
    expect(
      fitView({ x: 0, y: 0, w: 10, h: 10 }, { w: 600, h: 600 }).scale,
    ).toBe(1);
  });
});
