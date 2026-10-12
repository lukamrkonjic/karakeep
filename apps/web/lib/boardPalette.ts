import { deltaE, hexToLab } from "@karakeep/shared/utils/colours";

/**
 * Fork: a project board's colours (the strip in its header): every
 * picture's palette, weighed by how much of the board the picture takes,
 * alike colours taken together, the most of it first.
 */

/** Closer than this (CIE76 ΔE) is the same colour on the strip. */
const ALIKE = 14;

export function boardPalette(
  pictures: { colours: { hex: string; share: number }[]; area: number }[],
  size = 6,
): string[] {
  // Each group: its look (its weightiest colour), and its weight in all.
  const groups: {
    hex: string;
    lab: NonNullable<ReturnType<typeof hexToLab>>;
    top: number;
    weight: number;
  }[] = [];
  for (const { colours, area } of pictures) {
    for (const { hex, share } of colours) {
      const lab = hexToLab(hex);
      if (!lab || !(share > 0) || !(area > 0)) {
        continue;
      }
      const weight = share * area;
      const near = groups.find((g) => deltaE(g.lab, lab) < ALIKE);
      if (!near) {
        groups.push({ hex, lab, top: weight, weight });
        continue;
      }
      if (weight > near.top) {
        near.hex = hex;
        near.lab = lab;
        near.top = weight;
      }
      near.weight += weight;
    }
  }
  return groups
    .sort((a, b) => b.weight - a.weight)
    .slice(0, size)
    .map((g) => g.hex);
}
