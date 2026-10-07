/**
 * Fork: what a bookmark is as a file, for Download (one bookmark as itself,
 * several in a zip: app/api/bookmarks/download). A picture, video or PDF is
 * its own file, named as the preview's Download names it (the title you gave
 * it with the file's extension, else the file's own name); a note with a
 * video is the video; a note is a Markdown file; a link is an internet
 * shortcut (.url), which opens the page on Windows and macOS. Every name is
 * safe on Windows, macOS and Linux, and unique within one download.
 */

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
  "application/pdf": ".pdf",
  "text/html": ".html",
  "text/plain": ".txt",
  "text/markdown": ".md",
};

/** ".jpg" for image/jpeg; "" for a type it doesn't know. */
export function extensionOf(contentType: string | null | undefined): string {
  const type = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  return EXTENSIONS[type] ?? "";
}

/** The extension a name ends with (".jpg"), or "". */
function extensionIn(name: string | null | undefined): string {
  return name?.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "";
}

/**
 * A picture's, video's or PDF's name: the title with the file's extension,
 * else the file's own name, else `fallback` with the type's extension.
 */
export function assetFileName({
  title,
  fileName,
  contentType,
  fallback,
}: {
  title?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  fallback: string;
}): string {
  const extension = extensionIn(fileName) || extensionOf(contentType);
  const named = title?.trim();
  if (named) {
    return named.toLowerCase().endsWith(extension.toLowerCase())
      ? named
      : `${named}${extension}`;
  }
  const own = fileName?.trim();
  if (own) {
    return extensionIn(own) ? own : `${own}${extension}`;
  }
  return `${fallback}${extension}`;
}

/** A note's name: its title, else its first line (Markdown marks off). */
export function noteFileName(
  title: string | null | undefined,
  text: string,
): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[#>*+-]+\s*|\d+[.)]\s+)*(?:\[[ xX]\]\s*)?/, "")
        .trim(),
    )
    .find(Boolean);
  const name = title?.trim() || firstLine?.slice(0, 60).trim() || "Note";
  return `${name}.md`;
}

/** A link's name: its title, else its address without the scheme. */
export function linkFileName(title: string | null | undefined, url: string) {
  let address = url;
  try {
    const { hostname, pathname } = new URL(url);
    address = `${hostname.replace(/^www\./, "")}${pathname}`.replace(/\/$/, "");
  } catch {
    // Not an address after all: its text will do.
  }
  return `${title?.trim() || address || "Link"}.url`;
}

/** The .url file for a link (Windows' internet shortcut; macOS opens it too). */
export function internetShortcut(url: string): string {
  return `[InternetShortcut]\r\nURL=${url.replace(/[\r\n]/g, "")}\r\n`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const ILLEGAL = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

/** Allowed in a file name: not a control character, nor ILLEGAL. */
function allowed(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f && !ILLEGAL.has(character);
}

/**
 * A name any system takes: no / \ : * ? " < > | or control characters (as
 * Chrome saves them, "_"), no dots or spaces at either end (Windows drops
 * them; a leading dot hides the file), none of Windows' device names, and at
 * most `maxLength` characters with its extension kept.
 */
export function safeFileName(name: string, maxLength = 150): string {
  const extension = extensionIn(name);
  let base = Array.from(name.slice(0, name.length - extension.length))
    .map((character) => (allowed(character) ? character : "_"))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "");
  base = Array.from(base)
    .slice(0, Math.max(1, maxLength - extension.length))
    .join("")
    .replace(/[. ]+$/, "");
  if (!base) {
    base = "file";
  }
  if (RESERVED.test(base)) {
    base = `${base}_`;
  }
  return `${base}${extension}`;
}

/**
 * Hands out names for one download, each once — "a.jpg", "a (2).jpg"… —
 * telling "A.jpg" and "a.jpg" apart no more than Windows does.
 */
export function uniqueNamer(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    const extension = extensionIn(name);
    const base = name.slice(0, name.length - extension.length);
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      candidate = `${base} (${n})${extension}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

/** The zip's name: "Guitar (12 items).zip" from a list, else vrana's. */
export function zipFileName(name: string | null | undefined, count: number) {
  return safeFileName(`${name?.trim() || "vrana"} (${count} items).zip`);
}

/**
 * The header that makes the browser save the answer under `fileName`:
 * UTF-8 for those that read it (all current ones), plain ASCII for the rest.
 */
export function contentDisposition(fileName: string): string {
  const extension = extensionIn(fileName);
  const asciiBase = fileName
    .slice(0, fileName.length - extension.length)
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "_")
    .trim();
  const ascii = `${asciiBase || "download"}${extension}`;
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
