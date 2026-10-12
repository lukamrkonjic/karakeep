import { describe, expect, test } from "vitest";

import { boardPalette } from "./boardPalette";

describe("boardPalette", () => {
  test("weighs colours by the picture's size on the board", () => {
    expect(
      boardPalette([
        { colours: [{ hex: "#ff0000", share: 1 }], area: 100 },
        { colours: [{ hex: "#0000ff", share: 1 }], area: 400 },
      ]),
    ).toEqual(["#0000ff", "#ff0000"]);
  });

  test("alike colours are one, shown as the weightiest", () => {
    expect(
      boardPalette([
        {
          colours: [
            { hex: "#ff0000", share: 0.5 },
            { hex: "#fe0102", share: 0.3 },
            { hex: "#00ff00", share: 0.2 },
          ],
          area: 100,
        },
        { colours: [{ hex: "#fd0000", share: 0.6 }], area: 100 },
      ]),
    ).toEqual(["#fd0000", "#00ff00"]);
  });

  test("at most `size`, nothing from nothing", () => {
    const many = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"].map(
      (hex) => ({ colours: [{ hex, share: 1 }], area: 1 }),
    );
    expect(boardPalette(many, 3)).toHaveLength(3);
    expect(boardPalette([])).toEqual([]);
    expect(
      boardPalette([{ colours: [{ hex: "nope", share: 1 }], area: 1 }]),
    ).toEqual([]);
  });
});
