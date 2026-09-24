/**
 * Fork: what follows the pointer while bookmarks are dragged — a small copy
 * of the card's own picture, rounded and lifted, with more cards stacked
 * behind it and a count when several are dragged; a bookmark without a
 * picture shows its title on a card. Drawn on a canvas (always ready, unlike
 * an <img> that may not have decoded yet) and handed to setDragImage.
 */

const LONGEST = 104;
const SHORTEST = 60;
const PAD = 16; // room for the shadow and the stack
const RADIUS = 10;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The largest loaded picture (or playing video) inside the card. */
function pictureIn(
  card: HTMLElement,
): HTMLImageElement | HTMLVideoElement | null {
  const images = [...card.querySelectorAll("img")].filter(
    (img) => img.complete && img.naturalWidth > 0,
  );
  const videos = [...card.querySelectorAll("video")].filter(
    (video) => video.readyState >= 2 && video.videoWidth > 0,
  );
  const area = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };
  return [...images, ...videos].sort((a, b) => area(b) - area(a))[0] ?? null;
}

function themeColor(variable: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value ? `hsl(${value})` : fallback;
}

export function setBookmarkDragImage(
  e: React.DragEvent,
  title: string,
  count: number,
) {
  const card = e.currentTarget as HTMLElement;
  const picture = pictureIn(card);
  const natural = picture
    ? picture instanceof HTMLVideoElement
      ? { w: picture.videoWidth, h: picture.videoHeight }
      : { w: picture.naturalWidth, h: picture.naturalHeight }
    : null;

  // Keep the picture's shape, within LONGEST × SHORTEST..LONGEST.
  let w = LONGEST;
  let h = Math.round(LONGEST * 0.72);
  if (natural) {
    const ratio = natural.w / natural.h;
    if (ratio >= 1) {
      w = LONGEST;
      h = Math.max(SHORTEST, Math.round(LONGEST / ratio));
    } else {
      h = LONGEST;
      w = Math.max(SHORTEST, Math.round(LONGEST * ratio));
    }
  }

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  const cw = w + PAD * 2;
  const ch = h + PAD * 2;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  Object.assign(canvas.style, {
    position: "fixed",
    left: "-1000px",
    top: "-1000px",
    width: `${cw}px`,
    height: `${ch}px`,
    pointerEvents: "none",
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.scale(dpr, dpr);
  const card_bg = themeColor("--card", "#ffffff");
  const border = themeColor("--border", "#e4e4e7");

  // Cards stacked behind, turned a little, when several are dragged.
  for (let i = Math.min(count - 1, 2); i >= 1; i--) {
    ctx.save();
    ctx.translate(PAD + w / 2, PAD + h / 2);
    ctx.rotate(((i % 2 ? 1 : -1) * (4 + i * 2) * Math.PI) / 180);
    ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
    ctx.shadowBlur = 6;
    roundRect(ctx, -w / 2, -h / 2, w, h, RADIUS);
    ctx.fillStyle = card_bg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // The card itself, lifted.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, PAD, PAD, w, h, RADIUS);
  ctx.fillStyle = card_bg;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, PAD, PAD, w, h, RADIUS);
  ctx.clip();
  if (picture && natural) {
    // Cover: fill the card, cropping the overflow evenly.
    const scale = Math.max(w / natural.w, h / natural.h);
    const dw = natural.w * scale;
    const dh = natural.h * scale;
    ctx.drawImage(picture, PAD + (w - dw) / 2, PAD + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = themeColor("--foreground", "#0a0a0a");
    ctx.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textBaseline = "top";
    // Up to four lines of the title, cut at word boundaries.
    const words = (title || "Untitled").split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > w - 20 && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
      if (lines.length === 4) {
        break;
      }
    }
    if (lines.length < 4 && line) {
      lines.push(line);
    }
    lines.forEach((text, i) =>
      ctx.fillText(text, PAD + 10, PAD + 10 + i * 16, w - 20),
    );
  }
  ctx.restore();

  ctx.save();
  roundRect(ctx, PAD + 0.5, PAD + 0.5, w - 1, h - 1, RADIUS);
  ctx.strokeStyle = picture ? "rgba(255, 255, 255, 0.85)" : border;
  ctx.lineWidth = picture ? 2 : 1;
  ctx.stroke();
  ctx.restore();

  if (count > 1) {
    const label = count > 99 ? "99+" : String(count);
    ctx.save();
    ctx.font = `700 12px ${getComputedStyle(document.body).fontFamily}`;
    const bw = Math.max(22, ctx.measureText(label).width + 12);
    const bx = PAD + w - bw / 2 - 2;
    const by = PAD - 6;
    roundRect(ctx, bx - bw / 2, by, bw, 22, 11);
    ctx.fillStyle = themeColor("--primary", "#e11d48");
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = themeColor("--primary-foreground", "#ffffff");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx, by + 11.5);
    ctx.restore();
  }

  document.body.appendChild(canvas);
  e.dataTransfer.setDragImage(canvas, cw / 2, ch / 2);
  requestAnimationFrame(() => canvas.remove());
}
