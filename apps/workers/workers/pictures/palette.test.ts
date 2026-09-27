import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { deltaE, hexToLab } from "@karakeep/shared/utils/colours";

import { paletteOf } from "./palette";

function solid(width: number, height: number, hex: string) {
  return sharp({
    create: { width, height, channels: 3, background: hex },
  })
    .png()
    .toBuffer();
}

const near = (a: string, b: string) => deltaE(hexToLab(a)!, hexToLab(b)!) < 5;

describe("palettes", () => {
  test("one colour", async () => {
    const palette = await paletteOf(await solid(120, 80, "#286ff0"));
    expect(palette).toHaveLength(1);
    expect(near(palette[0].hex, "#286ff0")).toBe(true);
    expect(palette[0].share).toBe(1);
  });

  test("two halves, the bigger first", async () => {
    const left = await sharp({
      create: { width: 70, height: 100, channels: 3, background: "#c0392b" },
    })
      .png()
      .toBuffer();
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#fbfaf7" },
    })
      .composite([{ input: left, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const palette = await paletteOf(image);
    expect(palette).toHaveLength(2);
    expect(near(palette[0].hex, "#c0392b")).toBe(true);
    expect(palette[0].share).toBeCloseTo(0.7, 1);
    expect(near(palette[1].hex, "#fbfaf7")).toBe(true);
    // The same picture, the same colours.
    expect(await paletteOf(image)).toEqual(palette);
  });

  test("transparent pixels aren't part of the picture", async () => {
    const dot = await solid(20, 20, "#2a9d8f");
    const image = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: dot, left: 40, top: 40 }])
      .png()
      .toBuffer();
    const palette = await paletteOf(image);
    expect(palette).toHaveLength(1);
    expect(near(palette[0].hex, "#2a9d8f")).toBe(true);
  });
});
