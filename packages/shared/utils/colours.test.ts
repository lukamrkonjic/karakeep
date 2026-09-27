import { describe, expect, test } from "vitest";

import {
  colourMatch,
  colourSortKey,
  deltaE,
  hexToLab,
  labToRgb,
  normalizeHex,
  parseHex,
  rgbToLab,
  toHex,
} from "./colours";

describe("colours", () => {
  test("reads colours", () => {
    expect(parseHex("#286ff0")).toEqual([40, 111, 240]);
    expect(parseHex("286FF0")).toEqual([40, 111, 240]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("blue")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(toHex([40, 111, 240])).toBe("#286ff0");
  });

  test("CIELAB both ways", () => {
    const white = rgbToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(white[1]).toBeCloseTo(0, 1);
    expect(white[2]).toBeCloseTo(0, 1);
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 5);
    for (const hex of ["#286ff0", "#fbfaf7", "#191715", "#c0392b", "#7fb069"]) {
      expect(toHex(labToRgb(hexToLab(hex)!))).toBe(hex);
    }
  });

  test("CIEDE2000 (Sharma, Wu and Dalal's test data)", () => {
    expect(deltaE([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(
      2.0425,
      4,
    );
    expect(deltaE([50, 3.1571, -77.2803], [50, 0, -82.7485])).toBeCloseTo(
      2.8615,
      4,
    );
    expect(deltaE([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(
      deltaE([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387]),
    ).toBeCloseTo(1.2644, 4);
    expect(deltaE([50, 0, 0], [50, 0, 0])).toBe(0);
  });

  test("how much of a picture is near a colour", () => {
    const blue = hexToLab("#286ff0")!;
    const mostlyBlue = [
      { hex: "#2a70ee", share: 0.7 },
      { hex: "#ffffff", share: 0.3 },
    ];
    const aLittleBlue = [
      { hex: "#f4e9d8", share: 0.9 },
      { hex: "#3a78f2", share: 0.1 },
    ];
    const noBlue = [{ hex: "#c0392b", share: 1 }];
    expect(colourMatch(mostlyBlue, blue)).toBeCloseTo(0.7, 2);
    expect(colourMatch(aLittleBlue, blue)).toBeGreaterThan(0.05);
    expect(colourMatch(aLittleBlue, blue)).toBeLessThan(
      colourMatch(mostlyBlue, blue),
    );
    expect(colourMatch(noBlue, blue)).toBe(0);
  });

  test("sorted round the colour wheel, then the greys dark to light", () => {
    const key = (hex: string, share = 1) => colourSortKey([{ hex, share }])!;
    const order = [
      key("#d62828"), // red
      key("#f77f00"), // orange
      key("#fcbf49"), // yellow
      key("#2a9d8f"), // green-teal
      key("#286ff0"), // blue
      key("#7b2cbf"), // purple
      key("#111111"), // black
      key("#888888"), // grey
      key("#fbfaf7"), // beige-white
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // A small bright patch doesn't make a grey picture colourful…
    expect(
      colourSortKey([
        { hex: "#777777", share: 0.95 },
        { hex: "#ff0000", share: 0.05 },
      ]),
    ).toBeGreaterThanOrEqual(1);
    // …a big enough one does.
    expect(
      colourSortKey([
        { hex: "#777777", share: 0.7 },
        { hex: "#286ff0", share: 0.3 },
      ]),
    ).toBeLessThan(1);
    expect(colourSortKey([])).toBeNull();
  });
});
