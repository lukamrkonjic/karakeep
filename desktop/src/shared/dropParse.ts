import type { DropPayload } from "./types";

/**
 * Turning a native drop into "which URL is the actual media" is the fiddliest
 * part of this app: every browser advertises a different mix of flavours, and
 * the useful one is rarely the first. Kept separate from the overlay so it can
 * be exercised directly against captured payloads (see test/parse.html).
 */

export function isHttpish(url: string): boolean {
  return /^(https?:|data:)/i.test(url);
}

/**
 * An http(s) URL that looks like it points at media. Used only as a fallback
 * scan over raw markup, so it is deliberately conservative about extensions
 * and stops at quotes, whitespace and the usual delimiters.
 */
const MEDIA_URL_RE =
  /https?:\/\/[^\s"'<>\)]+\.(?:jpe?g|png|gif|webp|avif|mp4|webm|mkv)(?:\?[^\s"'<>\)]*)?/gi;

/** Splits a text/uri-list body, dropping its comment lines. */
export function parseUriList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Picks the largest candidate out of a srcset, by its width/density hint. */
function bestFromSrcset(srcset: string): string[] {
  const entries = srcset
    .split(",")
    .map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      if (!url) {
        return null;
      }
      const weight = descriptor ? parseFloat(descriptor) || 0 : 0;
      return { url, weight };
    })
    .filter((e): e is { url: string; weight: number } => e !== null)
    .filter((e) => isHttpish(e.url));
  entries.sort((a, b) => b.weight - a.weight);
  return entries.map((e) => e.url);
}

/**
 * Pulls media URLs out of the text/html flavour a browser puts on a drag.
 * Dragging an image yields a fragment like `<img src="…" alt="…">`, which is
 * both the most reliable URL and the only place the alt text lives.
 */
export function fromHtml(html: string): {
  urls: string[];
  title: string | null;
  baseUrl: string | null;
} {
  const urls: string[] = [];
  let title: string | null = null;
  let baseUrl: string | null = null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { urls, title, baseUrl };
  }

  // Chrome prefixes its drag fragment with the source document's URL as a
  // <base href>; when present it's both the Referer and the way to resolve
  // relative srcs.
  const base = doc.querySelector("base")?.getAttribute("href");
  if (base && isHttpish(base)) {
    baseUrl = base;
  }

  const absolutise = (raw: string): string | null => {
    if (isHttpish(raw)) {
      return raw;
    }
    if (!baseUrl) {
      // A relative src with no base is unusable — better to skip it than to
      // send the server a URL that can't resolve.
      return null;
    }
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return null;
    }
  };

  const img = doc.querySelector("img");
  if (img) {
    const srcset = img.getAttribute("srcset");
    if (srcset) {
      urls.push(...bestFromSrcset(srcset));
    }
    const src = img.getAttribute("src");
    const abs = src ? absolutise(src) : null;
    if (abs) {
      urls.push(abs);
    }
    title = img.getAttribute("alt")?.trim() || null;
  }

  for (const el of Array.from(doc.querySelectorAll("video, source"))) {
    // A <picture> puts its candidates on <source srcset>, not on src.
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      urls.push(
        ...bestFromSrcset(srcset)
          .map(absolutise)
          .filter((u): u is string => u !== null),
      );
    }
    const src = el.getAttribute("src");
    const abs = src ? absolutise(src) : null;
    if (abs) {
      urls.push(abs);
    }
    const poster = el.getAttribute("poster");
    const posterAbs = poster ? absolutise(poster) : null;
    if (posterAbs) {
      urls.push(posterAbs);
    }
  }

  // Plenty of sites paint the image as a CSS background on a plain div, in
  // which case there is no <img> to find.
  for (const el of Array.from(doc.querySelectorAll("[style*=background]"))) {
    const style = el.getAttribute("style") ?? "";
    for (const m of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      const abs = m[1] ? absolutise(m[1].trim()) : null;
      if (abs) {
        urls.push(abs);
      }
    }
  }

  const anchor = doc.querySelector("a");
  if (anchor) {
    const href = anchor.getAttribute("href");
    const abs = href ? absolutise(href) : null;
    if (abs) {
      urls.push(abs);
    }
    title ??= anchor.textContent?.trim() || null;
  }

  // Last resort: some sites hand over markup with the image reachable only
  // through attributes we don't model (lazy-load data-*, srcset on a wrapper,
  // inline JSON). Scanning the raw fragment for a media-looking URL is crude,
  // but it beats telling the user there was nothing in the drop.
  if (urls.length === 0) {
    for (const m of html.matchAll(MEDIA_URL_RE)) {
      if (m[0]) {
        urls.push(m[0].replace(/&amp;/g, "&"));
      }
    }
  }

  return { urls, title, baseUrl };
}

/** The string flavours a drop can carry, read synchronously from a DataTransfer. */
export interface DropStrings {
  html: string;
  uriList: string;
  mozUrl: string;
  plain: string;
}

/**
 * Merges every flavour into one ordered candidate list. Order matters: the
 * first URL that downloads as supported media wins, so the most specific
 * source (the dragged <img> itself) has to come before the page link that
 * merely contains it.
 */
export function mergeStrings(s: DropStrings): {
  urls: string[];
  title: string | null;
  sourcePageUrl: string | null;
} {
  const urls: string[] = [];
  let title: string | null = null;
  let sourcePageUrl: string | null = null;

  if (s.html) {
    const parsed = fromHtml(s.html);
    urls.push(...parsed.urls);
    title ??= parsed.title;
    sourcePageUrl ??= parsed.baseUrl;
  }
  if (s.uriList) {
    urls.push(...parseUriList(s.uriList).filter(isHttpish));
  }
  if (s.mozUrl) {
    // Firefox packs alternating "URL\nTITLE" lines into this flavour.
    const lines = s.mozUrl.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 2) {
      const url = lines[i]?.trim();
      if (url && isHttpish(url)) {
        urls.push(url);
      }
      title ??= lines[i + 1]?.trim() || null;
    }
  }
  if (s.plain) {
    const trimmed = s.plain.trim();
    if (isHttpish(trimmed)) {
      urls.push(trimmed);
    } else {
      title ??= trimmed.slice(0, 200) || null;
    }
  }

  if (urls.length === 0) {
    // Nothing matched the structured shapes. Sweep every flavour for anything
    // that looks like a media URL before giving up on the drop entirely.
    for (const body of [s.html, s.uriList, s.mozUrl, s.plain]) {
      for (const m of body.matchAll(MEDIA_URL_RE)) {
        if (m[0]) {
          urls.push(m[0].replace(/&amp;/g, "&"));
        }
      }
    }
  }

  return { urls: Array.from(new Set(urls)), title, sourcePageUrl };
}

export type ParsedStrings = Omit<DropPayload, "files" | "types" | "raw">;
