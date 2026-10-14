import { describe, expect, test } from "vitest";

import {
  colourFamily,
  colourMatch,
  colourQueryMatches,
  colourReach,
  colourSortKey,
  deltaE,
  familyShare,
  formatColourRange,
  hexToLab,
  labToRgb,
  normalizeHex,
  parseColourQuery,
  parseColourRange,
  parseHex,
  rgbToLab,
  toHex,
} from "./colours";

describe("colours", () => {
  test("how much of the picture a colour is to take up", () => {
    expect(parseColourRange("red")).toEqual({ colour: "red" });
    expect(parseColourRange("red>=40%")).toEqual({ colour: "red", min: 40 });
    expect(parseColourRange("Navy<20")).toEqual({ colour: "blue", max: 20 });
    expect(parseColourRange("#286FF0 >= 40% <= 80%")).toEqual({
      colour: "#286ff0",
      min: 40,
      max: 80,
    });
    for (const text of ["red>=", "red>=40%x", "sofa>=40%", ">=40%"]) {
      expect(parseColourRange(text), text).toBeNull();
    }
    expect(formatColourRange({ colour: "red", min: 40, max: 100 })).toBe(
      "red>=40%",
    );
    expect(formatColourRange({ colour: "red", min: 0, max: 20 })).toBe(
      "red>=0%<=20%",
    );

    const mostlyRed = [
      { hex: "#d62828", share: 0.6 },
      { hex: "#ffffff", share: 0.4 },
    ];
    expect(colourQueryMatches(mostlyRed, "red")).toBe(true);
    expect(colourQueryMatches(mostlyRed, "red", { min: 50 })).toBe(true);
    expect(colourQueryMatches(mostlyRed, "red", { min: 70 })).toBe(false);
    expect(colourQueryMatches(mostlyRed, "red", { max: 50 })).toBe(false);
    expect(colourQueryMatches(mostlyRed, "red", { min: 60, max: 60 })).toBe(
      true,
    );
    // From none at all: a picture without it too.
    expect(colourQueryMatches(mostlyRed, "blue")).toBe(false);
    expect(colourQueryMatches(mostlyRed, "blue", { min: 0, max: 10 })).toBe(
      true,
    );
  });

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

  test("how near a colour has to be: its accuracy", () => {
    // From crimson: 0.6 (the same), 11.5 (a brighter red), 19.1 (a
    // red-orange), 37.3 (orange) apart.
    const crimson = hexToLab("#ab2b3b")!;
    const same = [{ hex: "#ad2d3c", share: 1 }];
    const brighter = [{ hex: "#d62828", share: 1 }];
    const redOrange = [{ hex: "#d9532c", share: 1 }];
    const orange = [{ hex: "#f77f00", share: 1 }];
    // The default is as search by colour always was.
    expect(colourReach()).toEqual({ same: 8, other: 24 });
    expect(colourReach(50)).toEqual(colourReach());
    expect(colourReach(100).other).toBeCloseTo(8);
    expect(colourReach(0).other).toBeCloseTo(48);
    expect(colourMatch(same, crimson, 100)).toBe(1);
    expect(colourMatch(brighter, crimson)).toBeCloseTo((24 - 11.5) / 16, 1);
    expect(colourMatch(brighter, crimson, 90)).toBe(0);
    expect(colourMatch(redOrange, crimson)).toBeGreaterThan(0);
    expect(colourMatch(redOrange, crimson, 75)).toBe(0);
    expect(colourMatch(orange, crimson)).toBe(0);
    expect(colourMatch(orange, crimson, 0)).toBeGreaterThan(0.2);
    // A page of crimson at 90% keeps to it; at 0 the oranges come in.
    expect(colourQueryMatches(brighter, "#ab2b3b")).toBe(true);
    expect(colourQueryMatches(brighter, "#ab2b3b", { accuracy: 90 })).toBe(
      false,
    );
    expect(colourQueryMatches(orange, "#ab2b3b", { accuracy: 0 })).toBe(true);

    // A family's is measured from its swatch: exact, a dark wine (16.8
    // from red's red) is no longer red; loose, a coral pink (14.5) is.
    const wine = [{ hex: "#8e1f2f", share: 1 }];
    const coral = [{ hex: "#e05a6a", share: 1 }];
    expect(familyShare(wine, "red")).toBe(1);
    expect(familyShare(wine, "red", 75)).toBeGreaterThan(0.5);
    expect(familyShare(wine, "red", 100)).toBe(0);
    expect(familyShare(coral, "red")).toBe(0);
    expect(familyShare(coral, "red", 0)).toBeGreaterThan(0.5);
    const lightGrey = [{ hex: "#d8d8d8", share: 1 }];
    expect(familyShare(lightGrey, "white")).toBe(0);
    expect(familyShare(lightGrey, "white", 0)).toBe(1);

    // Written ~80%, alone or after the share; 50 is left out.
    expect(parseColourRange("#AB2B3B~80%")).toEqual({
      colour: "#ab2b3b",
      accuracy: 80,
    });
    expect(parseColourRange("red>=40%~30")).toEqual({
      colour: "red",
      min: 40,
      accuracy: 30,
    });
    expect(parseColourRange("red~")).toBeNull();
    expect(formatColourRange({ colour: "#ab2b3b", accuracy: 80 })).toBe(
      "#ab2b3b~80%",
    );
    expect(formatColourRange({ colour: "red", min: 40, accuracy: 50 })).toBe(
      "red>=40%",
    );
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

  test("colour families, as named colours are called", () => {
    const family = (hex: string) => colourFamily(hexToLab(hex)!);
    const expected: Record<string, string[]> = {
      red: ["#ff0000", "#dc143c", "#800000", "#b22222"],
      orange: ["#ff8c00", "#f77f00"],
      yellow: ["#ffd700", "#fcbf49", "#e1ad01", "#f0e68c"],
      green: ["#008000", "#32cd32", "#9caf88", "#808000", "#3b5323"],
      teal: ["#008080", "#2a9d8f", "#00ffff"],
      blue: ["#0000ff", "#286ff0", "#000080", "#87ceeb", "#1560bd"],
      purple: ["#800080", "#7b2cbf", "#ee82ee", "#c8a2c8"],
      pink: ["#ffc0cb", "#ff69b4", "#de5d83"],
      brown: ["#8b4513", "#a0522d", "#5c3317", "#b7410e", "#5a3a22"],
      beige: ["#d2b48c", "#c19a6b", "#f5f5dc", "#fffdd0", "#e8dcc4"],
      black: ["#111111", "#000000"],
      white: ["#fafafa", "#fbfaf7", "#ffffff"],
      grey: ["#808080", "#c0c0c0", "#36454f"],
    };
    for (const [name, hexes] of Object.entries(expected)) {
      for (const hex of hexes) {
        expect({ hex, family: family(hex) }).toEqual({ hex, family: name });
      }
    }
  });

  test("only vivid warm colours are red, orange or yellow", () => {
    const family = (hex: string) => colourFamily(hexToLab(hex)!);
    // Muted mid-tones from photos that all read as orange: skin in shade,
    // wood, stone, a tan jacket, a brown check coat.
    for (const hex of ["#b2775d", "#9f7c58", "#977051", "#9b8773", "#8c7464"]) {
      expect({ hex, family: family(hex) }).toEqual({ hex, family: "beige" });
    }
    // Skin, pink and golden, isn't red or orange either.
    expect(family("#e0a899")).toBe("beige");
    expect(family("#d69a6e")).toBe("beige");
    // A greyish tan street isn't yellow; a darker muted red-brown is brown.
    expect(family("#9c8e7d")).toBe("beige");
    expect(family("#83675e")).toBe("brown");
    // The real thing is: an ochre poster, autumn leaves, a pumpkin.
    for (const hex of ["#f4a637", "#e28d31", "#c26728", "#ff7518"]) {
      expect({ hex, family: family(hex) }).toEqual({ hex, family: "orange" });
    }

    // A man in a tan jacket isn't an orange picture, autumn trees are.
    const jacket = [
      { hex: "#b7ab99", share: 0.25 },
      { hex: "#9b8773", share: 0.24 },
      { hex: "#866148", share: 0.14 },
      { hex: "#5b3b2c", share: 0.14 },
      { hex: "#646470", share: 0.08 },
      { hex: "#9dbee1", share: 0.07 },
    ];
    expect(colourQueryMatches(jacket, "orange")).toBe(false);
    expect(colourQueryMatches(jacket, "beige")).toBe(true);
    const autumn = [
      { hex: "#f3ae44", share: 0.57 },
      { hex: "#e28d31", share: 0.25 },
      { hex: "#c26728", share: 0.08 },
      { hex: "#7e593e", share: 0.05 },
    ];
    expect(colourQueryMatches(autumn, "orange")).toBe(true);
  });

  test("searching by colour: a family, another name for one, or a colour", () => {
    expect(parseColourQuery("Red")).toBe("red");
    expect(parseColourQuery("gray")).toBe("grey");
    expect(parseColourQuery("navy")).toBe("blue");
    expect(parseColourQuery("#286FF0")).toBe("#286ff0");
    expect(parseColourQuery("286ff0")).toBe("#286ff0");
    expect(parseColourQuery("#abc")).toBe("#aabbcc");
    expect(parseColourQuery("sofa")).toBeNull();

    // A red sofa in a beige room is red; a speck of it isn't.
    const room = [
      { hex: "#e8dcc4", share: 0.7 },
      { hex: "#b22222", share: 0.2 },
      { hex: "#5c3317", share: 0.1 },
    ];
    expect(familyShare(room, "red")).toBeCloseTo(0.2, 5);
    expect(colourQueryMatches(room, "red")).toBe(true);
    expect(colourQueryMatches(room, "beige")).toBe(true);
    expect(colourQueryMatches(room, "blue")).toBe(false);
    expect(
      colourQueryMatches(
        [
          { hex: "#e8dcc4", share: 0.95 },
          { hex: "#b22222", share: 0.05 },
        ],
        "red",
      ),
    ).toBe(false);
    // White has to be most of it.
    expect(
      colourQueryMatches(
        [
          { hex: "#fafafa", share: 0.2 },
          { hex: "#286ff0", share: 0.8 },
        ],
        "white",
      ),
    ).toBe(false);
    expect(colourQueryMatches(room, "#b52424")).toBe(true);
  });
});
