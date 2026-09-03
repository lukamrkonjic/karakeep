import { clipboard } from "electron";

/**
 * Copy-to-save.
 *
 * A second way in for sites whose drags carry nothing at all. Pinterest
 * attaches zero types to a drag (verified in both a desktop app and a plain
 * browser page), and a YouTube video can't be dragged at all — but both offer
 * "Copy image link" / "Copy video URL" in their context menu, which hands
 * over exactly the URL worth saving, at full resolution.
 *
 * Two gates keep this out of the way of ordinary work:
 *   1. the copy has to have happened in a browser, and
 *   2. the content has to look like media worth saving.
 * Copying code, prose, a file path or an ordinary link does nothing at all.
 *
 * Note the clipboard API here is Electron's current asynchronous one
 * (`readText`/`has`/`read` returning promises, `read` yielding ClipboardItems);
 * the old synchronous `readImage`/`availableFormats` no longer exist.
 */

export type CopiedKind = "image" | "url";

export interface Copied {
  kind: CopiedKind;
  /** Present for kind === "url". */
  url: string | null;
}

const POLL_MS = 450;
const IMAGE_MIME = "image/png";

const BROWSER_EXES = new Set([
  "firefox.exe",
  "librewolf.exe",
  "waterfox.exe",
  "floorp.exe",
  "zen.exe",
  "chrome.exe",
  "chromium.exe",
  "thorium.exe",
  "msedge.exe",
  "brave.exe",
  "vivaldi.exe",
  "opera.exe",
  "arc.exe",
]);

/** A URL pointing straight at a media file — e.g. Pinterest's image link. */
const MEDIA_FILE_RE =
  /^https?:\/\/[^\s]+\.(?:jpe?g|png|gif|webp|avif|bmp|mp4|webm|mkv|mov)(?:\?[^\s]*)?$/i;

/**
 * Pages that *are* a single piece of media, where the page URL is the right
 * thing to save and the server's crawler does the rest. YouTube's "Copy video
 * URL" is the motivating case: there's no file extension to match on.
 */
const MEDIA_PAGE_RES = [
  /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?|shorts\/|live\/)/i,
  /^https?:\/\/youtu\.be\/[\w-]+/i,
  /^https?:\/\/(?:[a-z]{2}\.)?pinterest\.[a-z.]+\/pin\/\d+/i,
  /^https?:\/\/(?:www\.)?vimeo\.com\/\d+/i,
  /^https?:\/\/(?:www\.)?dailymotion\.com\/video\//i,
  /^https?:\/\/streamable\.com\/\w+/i,
  /^https?:\/\/(?:i\.)?imgur\.com\/\w+/i,
];

let timer: NodeJS.Timeout | null = null;
let lastSeen = "";

/**
 * get-windows is ESM-only. esbuild would rewrite a plain dynamic import into
 * require() for the CJS main bundle, which such a package rejects — so the
 * import is built at runtime where the bundler can't rewrite it.
 */
const importEsm = new Function("s", "return import(s)") as (
  s: string,
) => Promise<unknown>;

async function foregroundIsBrowser(): Promise<boolean> {
  try {
    const mod = (await importEsm("get-windows")) as {
      activeWindow: () => Promise<{ owner?: { path?: string } } | undefined>;
    };
    const win = await mod.activeWindow();
    const path = win?.owner?.path;
    if (!path) {
      return false;
    }
    const exe = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    return BROWSER_EXES.has(exe);
  } catch {
    // Can't tell — better to stay quiet than to pop up over unrelated work.
    return false;
  }
}

/**
 * Cheap enough to poll. An image is identified only by its presence, so two
 * different images copied back to back look alike; the URL case that actually
 * matters here compares exactly.
 */
async function fingerprint(): Promise<string> {
  const [text, hasImage] = await Promise.all([
    clipboard.readText(),
    clipboard.has(IMAGE_MIME),
  ]);
  return `${text}|${hasImage ? "img" : ""}`;
}

/**
 * What's on the clipboard, with no judgement about whether it was meant for
 * us. Used by the hotkey, where the user asked explicitly.
 */
export async function readClipboard(): Promise<Copied | null> {
  const text = (await clipboard.readText()).trim();
  if (/^https?:\/\//i.test(text)) {
    return { kind: "url", url: text };
  }
  if (!text && (await clipboard.has(IMAGE_MIME))) {
    return { kind: "image", url: null };
  }
  return null;
}

/**
 * The stricter test used by "auto" mode, where nothing was asked for and a
 * false positive puts a window over the user's work.
 */
export async function classifyClipboard(): Promise<Copied | null> {
  const copied = await readClipboard();
  if (!copied) {
    return null;
  }
  if (copied.kind === "image") {
    return copied;
  }
  const url = copied.url ?? "";
  const isMedia =
    MEDIA_FILE_RE.test(url) || MEDIA_PAGE_RES.some((re) => re.test(url));
  return isMedia ? copied : null;
}

/** Reads a copied bitmap as PNG bytes, or null when there isn't one. */
export async function readClipboardImage(): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!(await clipboard.has(IMAGE_MIME))) {
    return null;
  }
  // read() takes no arguments and yields every entry; pick the one that
  // actually advertises the image type.
  const items = await clipboard.read();
  for (const item of items) {
    if (!item.types.includes(IMAGE_MIME)) {
      continue;
    }
    try {
      const payload = await item.getType(IMAGE_MIME);
      // getType also resolves to a ClipboardBookmark for one special type,
      // so confirm this is really a Blob before reading bytes off it.
      if (payload instanceof Blob) {
        const buffer = await payload.arrayBuffer();
        return new Uint8Array(buffer);
      }
    } catch {
      // This entry didn't carry that type after all; try the next.
    }
  }
  return null;
}

export function stopClipboardWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function isWatching(): boolean {
  return timer !== null;
}

export function startClipboardWatch(onCopy: (copied: Copied) => void): void {
  stopClipboardWatch();

  // Seed from the current contents, so whatever happened to be on the
  // clipboard at startup doesn't immediately trigger a prompt.
  void fingerprint()
    .then((fp) => (lastSeen = fp))
    .catch(() => undefined);

  timer = setInterval(() => {
    void (async () => {
      let current: string;
      try {
        current = await fingerprint();
      } catch {
        return; // Another process held the clipboard; retry next tick.
      }
      if (current === lastSeen) {
        return;
      }
      lastSeen = current;

      const copied = await classifyClipboard();
      if (!copied) {
        return;
      }
      // Only ask the comparatively expensive foreground question once the
      // content already looks worth saving.
      if (await foregroundIsBrowser()) {
        onCopy(copied);
      }
    })();
  }, POLL_MS);
}

/** Re-seeds from the current contents, so a dismissal doesn't re-fire. */
export async function acknowledgeClipboard(): Promise<void> {
  try {
    lastSeen = await fingerprint();
  } catch {
    // Locked; the next poll resyncs.
  }
}
