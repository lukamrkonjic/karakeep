"use client";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type {
  ZProjectItem,
  ZProjectNoteStyle,
} from "@karakeep/shared/types/projects";
import { boundsOf } from "@karakeep/shared/projectLayout";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

import { NOTE_FONT, NOTE_LOOK } from "./BoardItem";
import { boardPictureOf } from "./boardPictures";

/**
 * Fork: a project's board as one picture (its "…" → Download as PNG / JPG):
 * everything on it, drawn in its stacking order on the board's colour, with
 * a margin round it — twice the board's own pixels where that fits in what
 * every browser can draw (Safari's canvas stops at about 16.7 million
 * pixels), less for a very big board.
 */

export type BoardExportFormat = "png" | "jpeg";

const MARGIN = 64;
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_000;
const RADIUS = 6;

/** A colour of the page's theme, as the board shows it now. */
function themeColour(variable: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value ? `hsl(${value})` : fallback;
}

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Another site's picture would keep the board from being saved. */
const ownPicture = (src: string) =>
  new URL(src, window.location.href).origin === window.location.origin;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** The lines words wrap to within `width`, as the board breaks them. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
      // A word longer than the line: broken where it reaches the edge.
      while (ctx.measureText(line).width > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) {
          cut--;
        }
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

function noteLook(style: ZProjectNoteStyle) {
  const size = NOTE_FONT[style.size];
  const card = style.colour !== "none";
  const pad = card ? Math.max(12, size * 0.5) : 0;
  return {
    size,
    weight: style.size === "l" || style.size === "xl" ? 600 : 400,
    padX: card ? pad : size * 0.15,
    padY: card ? pad : size * 0.1,
    background:
      style.colour === "none"
        ? null
        : style.colour === "paper"
          ? themeColour("--card", "#ffffff")
          : NOTE_LOOK[style.colour].swatch,
    ink:
      style.colour === "none"
        ? themeColour("--foreground", "#0a0a0a")
        : style.colour === "paper"
          ? themeColour("--card-foreground", "#0a0a0a")
          : "#1c1917",
  };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
) {
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}

/** The board, drawn: a picture file to save. */
export async function exportBoard({
  items,
  bookmarks,
  name,
  format,
}: {
  items: readonly ZProjectItem[];
  bookmarks: ReadonlyMap<string, ZBookmark>;
  name: string;
  format: BoardExportFormat;
}): Promise<File> {
  const box = boundsOf(items);
  if (!box) {
    throw new Error("The board is empty");
  }
  const area = {
    x: box.x - MARGIN,
    y: box.y - MARGIN,
    w: box.w + MARGIN * 2,
    h: box.h + MARGIN * 2,
  };
  const scale = Math.max(
    0.05,
    Math.min(
      2,
      Math.sqrt(MAX_PIXELS / (area.w * area.h)),
      MAX_SIDE / area.w,
      MAX_SIDE / area.h,
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.w * scale));
  canvas.height = Math.max(1, Math.round(area.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("This browser can't draw the board");
  }
  const font = getComputedStyle(document.body).fontFamily;
  ctx.scale(scale, scale);
  ctx.translate(-area.x, -area.y);
  ctx.fillStyle = themeColour("--background", "#ffffff");
  ctx.fillRect(area.x, area.y, area.w, area.h);

  const ordered = [...items].sort((a, b) => a.z - b.z);
  // Every picture at once, then drawn in order.
  const pictures = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    ordered.map(async (item) => {
      const bookmark = item.bookmarkId
        ? bookmarks.get(item.bookmarkId)
        : undefined;
      const picture = bookmark ? boardPictureOf(bookmark) : null;
      if (picture && ownPicture(picture.src)) {
        pictures.set(item.id, await load(picture.src));
      }
    }),
  );

  for (const item of ordered) {
    const { x, y, w, h } = item;
    if (item.kind === "note") {
      // Not written yet: not on the board for long, nor in its picture.
      if (!item.text?.trim()) {
        continue;
      }
      const look = noteLook(item.style ?? { size: "m", colour: "none" });
      ctx.font = `${look.weight} ${look.size}px ${font}`;
      ctx.textBaseline = "top";
      const lineHeight = look.size * 1.25;
      const lines = wrap(ctx, item.text ?? "", w - look.padX * 2);
      const height = Math.max(h, lines.length * lineHeight + look.padY * 2);
      if (look.background) {
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = look.background;
        roundedRect(ctx, x, y, w, height, RADIUS);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = look.ink;
      // Half the line's extra height above the words, as the page sets them.
      drawText(
        ctx,
        lines,
        x + look.padX,
        y + look.padY + (lineHeight - look.size) / 2,
        lineHeight,
      );
      continue;
    }

    const bookmark = item.bookmarkId
      ? bookmarks.get(item.bookmarkId)
      : undefined;
    const img = pictures.get(item.id);
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = img
      ? themeColour("--muted", "#e5e5e5")
      : themeColour("--card", "#ffffff");
    roundedRect(ctx, x, y, w, h, RADIUS);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRect(ctx, x, y, w, h, RADIUS);
    ctx.clip();
    if (img && img.naturalWidth > 0) {
      // Covering the box, cropped evenly, as the board shows it.
      const fit = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * fit;
      const dh = img.naturalHeight * fit;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      if (bookmark && boardPictureOf(bookmark)?.video) {
        const d = Math.min(48, Math.max(16, w * 0.14));
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.beginPath();
        ctx.arc(
          x + w * 0.06 + d / 2,
          y + w * 0.06 + d / 2,
          d / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        const cx = x + w * 0.06 + d / 2 + d * 0.06;
        const cy = y + w * 0.06 + d / 2;
        ctx.moveTo(cx - d * 0.16, cy - d * 0.22);
        ctx.lineTo(cx + d * 0.24, cy);
        ctx.lineTo(cx - d * 0.16, cy + d * 0.22);
        ctx.closePath();
        ctx.fill();
      }
    } else if (bookmark) {
      // A note or a link with no picture: its words on a card.
      const title = getBookmarkTitle(bookmark) ?? "";
      const words =
        bookmark.content.type === BookmarkTypes.TEXT
          ? bookmark.content.text
          : bookmark.content.type === BookmarkTypes.LINK
            ? bookmark.content.url
            : "";
      ctx.textBaseline = "top";
      ctx.fillStyle = themeColour("--card-foreground", "#0a0a0a");
      ctx.font = `600 14px ${font}`;
      const head = wrap(ctx, title, w - 24).slice(0, 2);
      drawText(ctx, head, x + 12, y + 12, 18);
      ctx.fillStyle = themeColour("--muted-foreground", "#737373");
      ctx.font = `400 12px ${font}`;
      const body = wrap(ctx, words, w - 24).slice(
        0,
        Math.max(0, Math.floor((h - 24 - head.length * 18) / 18)),
      );
      drawText(ctx, body, x + 12, y + 16 + head.length * 18, 18);
    }
    ctx.restore();
  }

  const type = format === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.92),
  );
  if (!blob) {
    throw new Error("The board couldn't be drawn");
  }
  return new File([blob], `${name}.${format === "png" ? "png" : "jpg"}`, {
    type,
  });
}
