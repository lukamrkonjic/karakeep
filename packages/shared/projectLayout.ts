/**
 * Fork: where things go on a project's board (types/projects.ts) — the
 * server placing pictures added from elsewhere, the board placing what's
 * dropped on it, and its Tidy up. Board pixels throughout: one is a screen
 * pixel at 100% zoom.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A new picture's width on the board. */
export const PICTURE_WIDTH = 240;
/** The room between things laid out together. */
export const GAP = 24;

/**
 * The room between things tidied up: more than a new block's, growing with
 * the pictures, so a tidied board breathes rather than packs.
 */
export function tidyGap(width: number): number {
  return Math.max(32, Math.round(width / 6));
}
/** A picture's height for its width when its size isn't known yet. */
export const DEFAULT_ASPECT = 1.25;

/** The box around them all; null for none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Do they overlap (touching isn't)? */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** A size at this width, its shape kept (a sliver can't be). */
export function atWidth(size: Size, width: number): Size {
  const aspect =
    size.w > 0 && size.h > 0 && Number.isFinite(size.h / size.w)
      ? size.h / size.w
      : DEFAULT_ASPECT;
  return { w: width, h: Math.max(1, Math.round(width * aspect * 100) / 100) };
}

/** Columns for a block of n things: about as wide as it's tall. */
export function blockColumns(n: number): number {
  return Math.max(1, Math.min(8, Math.round(Math.sqrt(n) * 1.25)));
}

/**
 * Masonry, as Pinterest lays pictures out: each in turn into the shortest
 * of `columns` columns `width` wide, its shape kept. Boxes from (0, 0).
 */
export function masonry(
  sizes: readonly Size[],
  columns: number,
  width: number,
  gap = GAP,
): { rects: Rect[]; w: number; h: number } {
  const cols = Math.max(1, Math.min(columns, sizes.length || 1));
  const heights = Array.from({ length: cols }, () => 0);
  const rects = sizes.map((size) => {
    const scaled = atWidth(size, width);
    let col = 0;
    for (let c = 1; c < cols; c++) {
      if (heights[c] < heights[col] - 0.5) {
        col = c;
      }
    }
    const rect = {
      x: col * (width + gap),
      y: heights[col],
      ...scaled,
    };
    heights[col] += scaled.h + gap;
    return rect;
  });
  return {
    rects,
    w: cols * width + (cols - 1) * gap,
    h: Math.max(0, Math.max(...heights) - gap),
  };
}

/**
 * Where new pictures go: a masonry block of them centred on `at` (a drop,
 * the middle of the screen), or, without it, to the right of what's on the
 * board already, level with its top (the middle of an empty one).
 */
export function placeNew(
  existing: readonly Rect[],
  sizes: readonly Size[],
  at?: Point,
): Rect[] {
  if (sizes.length === 0) {
    return [];
  }
  const block = masonry(sizes, blockColumns(sizes.length), PICTURE_WIDTH);
  const bounds = boundsOf(existing);
  const origin = at
    ? { x: at.x - block.w / 2, y: at.y - block.h / 2 }
    : bounds
      ? { x: bounds.x + bounds.w + GAP * 4, y: bounds.y }
      : { x: -block.w / 2, y: -block.h / 2 };
  return block.rects.map((r) => ({
    ...r,
    x: Math.round(r.x + origin.x),
    y: Math.round(r.y + origin.y),
  }));
}

export interface TidyItem extends Rect {
  id: string;
  /** A heading (a note without a card) starts a new group under it. */
  heading?: boolean;
  /** Keeps its shape when narrowed or widened (a picture). */
  keepsShape?: boolean;
}

/**
 * In reading order: top to bottom, and left to right along a row — two
 * things are in one row when they overlap by most of the shorter's height.
 */
export function readingOrder<T extends Rect>(items: readonly T[]): T[] {
  const byTop = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  for (const item of byTop) {
    const row = rows[rows.length - 1];
    const sameRow =
      row &&
      row.some((other) => {
        const overlap =
          Math.min(other.y + other.h, item.y + item.h) -
          Math.max(other.y, item.y);
        return overlap > Math.min(other.h, item.h) * 0.5;
      });
    if (sameRow) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * Tidy up: the items as a masonry block where they start (their top-left),
 * in reading order, every column as wide as the pictures' usual width. A
 * heading starts a new group, under everything before it, at its own size.
 * Returns each item's new box.
 */
export function tidy(items: readonly TidyItem[]): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const bounds = boundsOf(items);
  if (!bounds) {
    return out;
  }
  const pictures = items.filter((i) => i.keepsShape).map((i) => i.w);
  pictures.sort((a, b) => a - b);
  const width = Math.round(
    Math.min(
      600,
      Math.max(
        120,
        pictures.length > 0
          ? pictures[Math.floor(pictures.length / 2)]
          : PICTURE_WIDTH,
      ),
    ),
  );
  const flowing = items.filter((i) => !i.heading).length;
  const columns = blockColumns(flowing);
  const gap = tidyGap(width);
  const blockWidth = columns * width + (columns - 1) * gap;

  let top = bounds.y;
  let heights = Array.from({ length: columns }, () => top);
  // Whether the group under the last heading (or the first) has anything.
  let filled = false;

  for (const item of readingOrder(items)) {
    if (item.heading) {
      // Under everything so far, with twice the room above it when it ends
      // a group.
      const y = filled ? Math.max(...heights) - gap + gap * 2 : top;
      out.set(item.id, {
        x: bounds.x,
        y,
        w: Math.min(item.w, blockWidth),
        h: item.h,
      });
      top = y + item.h + gap;
      heights = Array.from({ length: columns }, () => top);
      filled = false;
      continue;
    }
    filled = true;
    let col = 0;
    for (let c = 1; c < columns; c++) {
      if (heights[c] < heights[col] - 0.5) {
        col = c;
      }
    }
    const size = item.keepsShape
      ? atWidth(item, width)
      : { w: width, h: item.h };
    out.set(item.id, {
      x: bounds.x + col * (width + gap),
      y: heights[col],
      ...size,
    });
    heights[col] += size.h + gap;
  }
  return out;
}

/** The zoom and the board's offset that show `content` whole in a viewport. */
export function fitView(
  content: Rect,
  viewport: Size,
  { padding = 48, maxScale = 1, minScale = 0.05 } = {},
): { scale: number; x: number; y: number } {
  const room = {
    w: Math.max(1, viewport.w - padding * 2),
    h: Math.max(1, viewport.h - padding * 2),
  };
  const scale = Math.max(
    minScale,
    Math.min(
      maxScale,
      room.w / Math.max(1, content.w),
      room.h / Math.max(1, content.h),
    ),
  );
  return {
    scale,
    x: viewport.w / 2 - (content.x + content.w / 2) * scale,
    y: viewport.h / 2 - (content.y + content.h / 2) * scale,
  };
}
