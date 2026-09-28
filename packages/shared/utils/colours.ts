/**
 * Fork: colours for the pictures' palettes (Settings → Pictures → Colours):
 * reading a colour, how different two colours look (CIEDE2000, in CIELAB),
 * how much of a picture is near a colour (search by colour), and where a
 * picture goes when a list is sorted by colour. The workers make the
 * palettes (apps/workers/workers/pictures/palette.ts); the API and the web
 * app read them.
 */

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export interface PaletteColour {
  /** "#rrggbb" */
  hex: string;
  /** How much of the picture it covers, 0–1. */
  share: number;
}

/** "#rgb", "#rrggbb" (the # optional) as numbers; null if it isn't one. */
export function parseHex(text: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) {
    return null;
  }
  const digits =
    m[1].length === 3
      ? [...m[1]].map((d) => d + d).join("")
      : m[1].toLowerCase();
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** A colour as "#rrggbb", or null if the text isn't one. */
export function normalizeHex(text: string): string | null {
  const rgb = parseHex(text);
  return rgb ? toHex(rgb) : null;
}

// sRGB's D65 white, and CIE's constants.
const WHITE = [0.95047, 1, 1.08883];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

export function rgbToLab([r, g, b]: Rgb): Lab {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / WHITE[0];
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / WHITE[1];
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / WHITE[2];
  const f = (t: number) =>
    t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([l, a, b]: Lab): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (t: number) =>
    t ** 3 > EPSILON ? t ** 3 : (116 * t - 16) / KAPPA;
  const x = inverse(fx) * WHITE[0];
  const y = (l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA) * WHITE[1];
  const z = inverse(fz) * WHITE[2];
  const gamma = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, v)) * 255;
  };
  return [
    gamma(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    gamma(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    gamma(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ];
}

export function hexToLab(hex: string): Lab | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToLab(rgb) : null;
}

/**
 * How different two colours look (CIEDE2000): under 1 no one sees it, about
 * 2–10 at a glance, past 25 they're other colours.
 */
export function deltaE([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const pow7 = (v: number) => v ** 7;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(pow7(cBar) / (pow7(cBar) + pow7(25))));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hueOf = (a: number, b: number) => {
    if (a === 0 && b === 0) {
      return 0;
    }
    const h = Math.atan2(b, a) / rad;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hueOf(a1p, b1);
  const h2p = hueOf(a2p, b2);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) {
      dhp -= 360;
    } else if (dhp < -180) {
      dhp += 360;
    }
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * rad) / 2);

  const lBarp = (l1 + l2) / 2;
  const cBarp = (c1p + c2p) / 2;
  let hBarp = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) {
      hBarp = (h1p + h2p) / 2;
    } else {
      hBarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    }
  }
  const t =
    1 -
    0.17 * Math.cos((hBarp - 30) * rad) +
    0.24 * Math.cos(2 * hBarp * rad) +
    0.32 * Math.cos((3 * hBarp + 6) * rad) -
    0.2 * Math.cos((4 * hBarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(pow7(cBarp) / (pow7(cBarp) + pow7(25)));
  const sl =
    1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt(
    (dLp / sl) ** 2 +
      (dCp / sc) ** 2 +
      (dHp / sh) ** 2 +
      rt * (dCp / sc) * (dHp / sh),
  );
}

/**
 * Search by colour: a colour within `SAME` counts fully as the one asked
 * for, one past `OTHER` not at all, and in between partly — so "that blue"
 * takes its lighter and darker shades too.
 */
const SAME = 8;
const OTHER = 24;

/** How much of the picture is the colour, 0–1 (see SAME and OTHER). */
export function colourMatch(palette: PaletteColour[], target: Lab): number {
  let score = 0;
  for (const colour of palette) {
    const lab = hexToLab(colour.hex);
    if (!lab) {
      continue;
    }
    const distance = deltaE(lab, target);
    const weight =
      distance <= SAME
        ? 1
        : distance >= OTHER
          ? 0
          : (OTHER - distance) / (OTHER - SAME);
    score += colour.share * weight;
  }
  return score;
}

/** At least this much of a picture near the colour for it to count. */
export const COLOUR_MATCH_MIN = 0.05;

// Chroma (CIELAB) below which a colour is a grey, black, white or beige.
const NEUTRAL_CHROMA = 12;
// The wheel starts at red (CIELAB's hue 0° is a pinkish red).
const WHEEL_START = 350;

/**
 * Where a picture goes when sorted by colour (ascending): round the colour
 * wheel from red, by its most telling colour — the most colourful of those
 * covering a good part of it — and pictures with next to no colour after
 * all the others, dark to light. Null without a palette.
 */
export function colourSortKey(palette: PaletteColour[]): number | null {
  let telling: { lab: Lab; weight: number; chroma: number } | null = null;
  let biggest: Lab | null = null;
  for (const colour of palette) {
    const lab = hexToLab(colour.hex);
    if (!lab) {
      continue;
    }
    biggest ??= lab;
    if (colour.share < 0.08) {
      continue;
    }
    const chroma = Math.hypot(lab[1], lab[2]);
    const weight = chroma * Math.sqrt(colour.share);
    if (!telling || weight > telling.weight) {
      telling = { lab, weight, chroma };
    }
  }
  if (!biggest) {
    return null;
  }
  if (!telling || telling.chroma < NEUTRAL_CHROMA) {
    // 1–2: after every colourful picture, darkest first.
    return 1 + Math.min(Math.max(biggest[0], 0), 100) / 100.01;
  }
  const hue = (Math.atan2(telling.lab[2], telling.lab[1]) * 180) / Math.PI;
  return ((((hue - WHEEL_START) % 360) + 360) % 360) / 360;
}

/**
 * The colour families pictures are grouped by — search (`color:red`), smart
 * lists and the colour page's chips. A picture is in a family when enough of
 * it is of that family's colours (FAMILY_SHARE).
 */
export const COLOUR_FAMILIES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
  "beige",
  "black",
  "white",
  "grey",
] as const;
export type ColourFamily = (typeof COLOUR_FAMILIES)[number];

/** How each family is shown (its chip, a smart list's icon). */
export const FAMILY_SWATCHES: Record<ColourFamily, string> = {
  red: "#d62828",
  orange: "#f77f00",
  yellow: "#f6c945",
  green: "#3a9d4f",
  teal: "#2a9d8f",
  blue: "#286ff0",
  purple: "#7b2cbf",
  pink: "#f06ea9",
  brown: "#8b5a2b",
  beige: "#e8dcc4",
  black: "#151515",
  white: "#f7f7f5",
  grey: "#8a8a8a",
};
// Other names for a family, as people search.
const FAMILY_ALIASES: Record<string, ColourFamily> = {
  gray: "grey",
  cyan: "teal",
  turquoise: "teal",
  aqua: "teal",
  navy: "blue",
  violet: "purple",
  lilac: "purple",
  lavender: "purple",
  magenta: "pink",
  rose: "pink",
  maroon: "red",
  burgundy: "red",
  crimson: "red",
  gold: "yellow",
  mustard: "yellow",
  olive: "green",
  sage: "green",
  mint: "green",
  cream: "beige",
  tan: "beige",
  sand: "beige",
  camel: "beige",
  chocolate: "brown",
};

const NEUTRALS = new Set<ColourFamily>(["black", "white", "grey", "beige"]);

// The chroma (CIELAB) a warm colour needs to be red, orange or yellow.
const WARM_VIVID = 40;

/**
 * The family of one colour, by where it sits in CIELAB — measured on named
 * colours: tan, camel, sand and oat are beige; sienna, chocolate and rust
 * brown; sage and olive green; navy and denim blue. Only a vivid warm colour
 * is red, orange or yellow: a muted one — skin, wood, sand, stone, a tan
 * coat, often much of a photo — is beige, or brown when dark. (Those in
 * between made nearly every photo orange.)
 */
export function colourFamily([l, a, b]: Lab): ColourFamily {
  const chroma = Math.hypot(a, b);
  const hue = ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
  if (chroma < 10) {
    return l < 25 ? "black" : l > 88 ? "white" : "grey";
  }
  if (l < 12) {
    return "black";
  }
  if (hue >= 45 && hue < 95 && l < 50) {
    return "brown";
  }
  if (hue >= 30 && hue < 100 && chroma < WARM_VIVID) {
    return l < 50 ? "brown" : "beige";
  }
  if (hue >= 50 && hue < 110 && chroma < 32 && l >= 60) {
    return "beige";
  }
  if (hue >= 20 && hue < 48) {
    return "red";
  }
  if (hue >= 48 && hue < 75) {
    return "orange";
  }
  // Khaki sits just past yellow, olive a little further: the light ones
  // are yellow.
  if (hue >= 75 && (hue < 100 || (hue < 110 && l >= 80))) {
    return "yellow";
  }
  if (hue >= 100 && hue < 165) {
    return "green";
  }
  if (hue >= 165 && hue < 220) {
    return "teal";
  }
  if (hue >= 220 && hue < 310) {
    return "blue";
  }
  if (hue >= 310 && hue < 340) {
    return "purple";
  }
  // 340–20: pink, or a dark wine red.
  return l < 40 ? "red" : "pink";
}

/** How much of a picture is of a family's colours, 0–1. */
export function familyShare(
  palette: PaletteColour[],
  family: ColourFamily,
): number {
  let share = 0;
  for (const colour of palette) {
    const lab = hexToLab(colour.hex);
    if (lab && colourFamily(lab) === family) {
      share += colour.share;
    }
  }
  return share;
}

/**
 * At least this much of a picture for it to be in a family: a little for a
 * colour (a red sofa in a beige room is red), most of it for black, white,
 * grey and beige, which are in nearly every picture.
 */
export function familyMinimum(family: ColourFamily): number {
  return NEUTRALS.has(family) ? 0.35 : 0.12;
}

export function isColourFamily(text: string): text is ColourFamily {
  return (COLOUR_FAMILIES as readonly string[]).includes(text);
}

/**
 * A colour as searched for: a family ("red", or another name for one like
 * "navy") or an exact colour ("#286ff0", the # optional) — as "red" or
 * "#286ff0"; null when it's neither.
 */
export function parseColourQuery(text: string): string | null {
  const word = text.trim().toLowerCase();
  if (isColourFamily(word)) {
    return word;
  }
  if (FAMILY_ALIASES[word]) {
    return FAMILY_ALIASES[word];
  }
  return /^#?[0-9a-f]{6}$|^#[0-9a-f]{3}$/i.test(word)
    ? normalizeHex(word)
    : null;
}

/**
 * How much of a picture answers a parsed colour query (parseColourQuery), and
 * whether that's enough for it to count.
 */
export function colourQueryScore(
  palette: PaletteColour[],
  query: string,
): number {
  if (isColourFamily(query)) {
    return familyShare(palette, query);
  }
  const target = hexToLab(query);
  return target ? colourMatch(palette, target) : 0;
}

/** How much of a picture a colour counts from: its family's, or a colour's. */
export function colourMinimum(query: string): number {
  return isColourFamily(query) ? familyMinimum(query) : COLOUR_MATCH_MIN;
}

/**
 * How much of a picture a colour is to take up, in percent (a smart list's
 * colour rule, `color:red>=40%`). Unset, `min` is the colour's own minimum
 * (colourMinimum) — any of it that counts — and `max` all of the picture.
 */
export interface ColourShare {
  min?: number;
  max?: number;
}

export function colourQueryMatches(
  palette: PaletteColour[],
  query: string,
  share: ColourShare = {},
): boolean {
  const score = colourQueryScore(palette, query);
  const min = share.min === undefined ? colourMinimum(query) : share.min / 100;
  // A palette's shares can add up a hair over 1.
  const max = share.max === undefined ? Infinity : share.max / 100 + 1e-9;
  return score >= min && score <= max;
}

/** A colour and how much of a picture it takes up (ColourShare). */
export interface ColourRange extends ColourShare {
  colour: string;
}

/**
 * "red", "red>=40%" (at least), "#286ff0<=20%" (at most), "red>=40%<=80%"
 * (between) — also with > and <, and without the % — as a colour
 * (parseColourQuery) and its share; null when it's none of those.
 */
export function parseColourRange(text: string): ColourRange | null {
  const at = text.search(/[<>]/);
  const colour = parseColourQuery(at < 0 ? text : text.slice(0, at));
  if (!colour) {
    return null;
  }
  const range: ColourRange = { colour };
  if (at < 0) {
    return range;
  }
  const bounds = text.slice(at).replace(/\s+/g, "");
  const bound = /([<>])=?(\d{1,3}(?:\.\d+)?)%?/y;
  let read = 0;
  for (let found = bound.exec(bounds); found; found = bound.exec(bounds)) {
    const percent = Math.min(100, Number(found[2]));
    if (found[1] === ">") {
      range.min = percent;
    } else {
      range.max = percent;
    }
    read = bound.lastIndex;
  }
  return read === bounds.length ? range : null;
}

/** The other way: "red>=40%<=80%", what's unset (or all of it) left out. */
export function formatColourRange({ colour, min, max }: ColourRange): string {
  return (
    colour +
    (min === undefined ? "" : `>=${min}%`) +
    (max === undefined || max >= 100 ? "" : `<=${max}%`)
  );
}
