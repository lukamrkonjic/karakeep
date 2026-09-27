import type { Lab, PaletteColour } from "@karakeep/shared/utils/colours";
import {
  deltaE,
  labToRgb,
  rgbToLab,
  toHex,
} from "@karakeep/shared/utils/colours";

/**
 * Fork: a picture's main colours (Settings → Pictures → Colours). The
 * picture shrunk to fit 80 × 80, its pixels grouped by colour (k-means, in
 * CIELAB, where distance is how different colours look), groups that look
 * the same merged, the small ones dropped: up to six colours, the biggest
 * first, with how much of the picture each covers. Transparent pixels
 * aren't part of the picture. Deterministic: the same picture always gives
 * the same colours.
 */

const SIZE = 80;
const GROUPS = 8;
const ROUNDS = 16;
// Groups closer than this (CIEDE2000) are one colour.
const SAME_COLOUR = 10;
const MIN_SHARE = 0.02;
const MAX_COLOURS = 6;

/** A small, seeded random source: the same picture, the same colours. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance2(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/** k-means with k-means++ starting points; each centre and its size. */
function groups(points: Lab[], k: number): { centre: Lab; size: number }[] {
  const random = seeded(points.length);
  const centres: Lab[] = [points[Math.floor(random() * points.length)]];
  const nearest = points.map((p) => distance2(p, centres[0]));
  while (centres.length < Math.min(k, points.length)) {
    const total = nearest.reduce((sum, d) => sum + d, 0);
    if (total === 0) {
      break; // one colour only
    }
    let pick = random() * total;
    let index = 0;
    for (; index < points.length - 1; index++) {
      pick -= nearest[index];
      if (pick <= 0) {
        break;
      }
    }
    centres.push(points[index]);
    points.forEach((p, i) => {
      nearest[i] = Math.min(nearest[i], distance2(p, points[index]));
    });
  }

  const assigned = new Int32Array(points.length).fill(-1);
  for (let round = 0; round < ROUNDS; round++) {
    let moved = 0;
    points.forEach((p, i) => {
      let best = 0;
      let bestDistance = Infinity;
      centres.forEach((c, j) => {
        const d = distance2(p, c);
        if (d < bestDistance) {
          bestDistance = d;
          best = j;
        }
      });
      if (assigned[i] !== best) {
        assigned[i] = best;
        moved++;
      }
    });
    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const sum = sums[assigned[i]];
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      sum[3] += 1;
    });
    sums.forEach(([l, a, b, n], j) => {
      if (n > 0) {
        centres[j] = [l / n, a / n, b / n];
      }
    });
    if (moved === 0) {
      break;
    }
  }
  const sizes = centres.map(() => 0);
  assigned.forEach((j) => sizes[j]++);
  return centres
    .map((centre, j) => ({ centre, size: sizes[j] }))
    .filter((g) => g.size > 0);
}

/** The colours of pixels (CIELAB), biggest first. */
export function paletteOfPoints(points: Lab[]): PaletteColour[] {
  if (points.length === 0) {
    return [];
  }
  const merged: { centre: Lab; size: number }[] = [];
  for (const group of groups(points, GROUPS).sort((a, b) => b.size - a.size)) {
    const same = merged.find(
      (m) => deltaE(m.centre, group.centre) < SAME_COLOUR,
    );
    if (same) {
      const size = same.size + group.size;
      same.centre = same.centre.map(
        (v, i) => (v * same.size + group.centre[i] * group.size) / size,
      ) as Lab;
      same.size = size;
    } else {
      merged.push({ ...group, centre: [...group.centre] as Lab });
    }
  }
  return merged
    .sort((a, b) => b.size - a.size)
    .map((m) => ({
      hex: toHex(labToRgb(m.centre)),
      share: Math.round((m.size / points.length) * 1000) / 1000,
    }))
    .filter((c) => c.share >= MIN_SHARE)
    .slice(0, MAX_COLOURS);
}

/** A picture's main colours, biggest first. */
export async function paletteOf(image: Buffer): Promise<PaletteColour[]> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(image, { failOn: "none" })
    .rotate()
    .resize(SIZE, SIZE, { fit: "inside" })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const points: Lab[] = [];
  for (let i = 0; i + 3 < data.length; i += info.channels) {
    if (data[i + 3] < 128) {
      continue; // transparent: not part of the picture
    }
    points.push(rgbToLab([data[i], data[i + 1], data[i + 2]]));
  }
  return paletteOfPoints(points);
}
