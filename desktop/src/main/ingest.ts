import { basename } from "node:path";
import { clipboard } from "electron";
import {
  ClipboardIngestRequest,
  IngestResult,
  SaveSource,
} from "../shared/types";
import { readClipboardImage } from "./clipboardWatch";
import {
  addToList,
  createAssetBookmark,
  createLinkBookmark,
  uploadAsset,
} from "./karakeep";

/**
 * What the server will accept as a bookmark's own content, mirroring
 * SUPPORTED_BOOKMARK_ASSET_TYPES in packages/shared/assetdb.ts. Anything else
 * has to become a link bookmark instead.
 */
const ASSET_KIND_BY_MIME: Record<string, "image" | "video" | "pdf"> = {
  "image/avif": "image",
  "image/gif": "image",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/x-matroska": "video",
  "application/pdf": "pdf",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "application/pdf": "pdf",
};

/** Magic-number sniffing, for when the server's Content-Type is wrong or absent. */
function sniffMime(bytes: Uint8Array<ArrayBuffer>): string | null {
  const b = bytes;
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);

  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm"; // also matroska
  // RIFF....WEBP
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) {
    return "image/webp";
  }
  // ....ftyp — an ISO base-media container (mp4 and friends)
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    // ftypavif / ftypavis: an AVIF picture (or sequence), not a video
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (brand === "avif" || brand === "avis") return "image/avif";
    return "video/mp4";
  }
  return null;
}

function normaliseMime(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  // Strip "; charset=..." and normalise the handful of aliases we see.
  const mime = raw.split(";")[0]!.trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "video/x-m4v" || mime === "video/quicktime") return "video/mp4";
  if (mime === "video/matroska") return "video/x-matroska";
  return mime || null;
}

function fileNameFor(url: string | null, mime: string, fallback: string): string {
  let name = fallback;
  if (url) {
    try {
      const path = new URL(url).pathname;
      const candidate = decodeURIComponent(basename(path));
      if (candidate && candidate !== "/") {
        name = candidate;
      }
    } catch {
      // Unparseable URL — keep the fallback.
    }
  }
  // Query-string junk and missing extensions both trip up the server's
  // filename handling, so rebuild the extension from the sniffed type.
  name = name.split("?")[0]!.split("#")[0]!;
  const ext = EXT_BY_MIME[mime];
  if (ext && !name.toLowerCase().endsWith(`.${ext}`)) {
    name = `${name.replace(/\.[a-z0-9]{1,5}$/i, "")}.${ext}`;
  }
  return name.replace(/[^\x20-\x7E]/g, "_").slice(0, 120) || `dropped.${ext ?? "bin"}`;
}

/**
 * How a remote resource gets fetched. The collector browser passes its tab's
 * session fetch, so cookies and referer come from the page you are actually
 * looking at — which is what rescues media the tray flow can only 403 on.
 */
export type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: "follow" | "error" | "manual" },
) => Promise<Response>;

interface Media {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  fileName: string;
  sourceUrl: string | null;
}

async function downloadMedia(
  url: string,
  referer: string | null,
  fetchImpl: FetchImpl = fetch,
): Promise<Media | null> {
  if (url.startsWith("data:")) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
    if (!match) {
      return null;
    }
    const mime = normaliseMime(match[1]) ?? "application/octet-stream";
    const bytes = match[2]
      ? new Uint8Array(Buffer.from(match[3]!, "base64"))
      : new Uint8Array(Buffer.from(decodeURIComponent(match[3]!), "utf-8"));
    return { bytes, mime, fileName: fileNameFor(null, mime, "pasted"), sourceUrl: referer };
  }

  // Send a browser-ish request: plenty of CDNs 403 an unadorned fetch, and a
  // Referer from the originating page is what makes hotlink checks pass.
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/*,video/*,*/*;q=0.8",
  };
  if (referer) {
    headers.Referer = referer;
    try {
      headers.Origin = new URL(referer).origin;
    } catch {
      // Referer wasn't a URL; skip Origin.
    }
  }

  const res = await fetchImpl(url, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status} ${res.statusText})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    return null;
  }
  const mime =
    sniffMime(bytes) ?? normaliseMime(res.headers.get("content-type")) ?? "";
  if (!ASSET_KIND_BY_MIME[mime]) {
    return null;
  }
  return {
    bytes,
    mime,
    fileName: fileNameFor(res.url || url, mime, "dropped"),
    sourceUrl: referer ?? url,
  };
}

/**
 * Saves one thing into an optional list. Bytes are uploaded as they are; a
 * URL is fetched first and only falls back to a link bookmark when it isn't
 * media the server would accept as a bookmark's own content.
 */
export async function saveSource(
  source: SaveSource,
  target: ClipboardIngestRequest,
  opts?: { fetchImpl?: FetchImpl; referer?: string | null },
): Promise<IngestResult> {
  try {
    let bookmark: { id: string; alreadyExists?: boolean };

    let media: Media | null = null;
    let downloadError: string | null = null;

    if (source.bytes) {
      const mime = sniffMime(source.bytes) ?? "image/png";
      media = {
        bytes: source.bytes,
        mime,
        fileName: fileNameFor(null, mime, "clipboard"),
        sourceUrl: null,
      };
    } else if (source.url) {
      try {
        // Most hotlink checks only compare hosts, so the media's own origin
        // works as a Referer when we have nothing better.
        let referer: string | null = null;
        if (opts?.referer !== undefined) {
          referer = opts.referer;
        } else if (!source.url.startsWith("data:")) {
          try {
            referer = new URL(source.url).origin + "/";
          } catch {
            referer = null;
          }
        }
        media = await downloadMedia(source.url, referer, opts?.fetchImpl);
      } catch (e) {
        downloadError = e instanceof Error ? e.message : String(e);
      }
    }

    if (media) {
      const asset = await uploadAsset(media.bytes, media.fileName, media.mime);
      bookmark = await createAssetBookmark({
        asset,
        assetType: ASSET_KIND_BY_MIME[media.mime]!,
        title: source.title,
        sourceUrl: media.sourceUrl,
      });
    } else if (source.url) {
      // Not a media file — a YouTube page, say. Save the link and let the
      // server's crawler do the rest.
      bookmark = await createLinkBookmark(source.url, source.title);
    } else {
      return { ok: false, error: downloadError ?? "Nothing to save." };
    }

    return await fileInto(bookmark, target);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Adds a freshly created bookmark to the chosen list, if there was one. */
async function fileInto(
  bookmark: { id: string; alreadyExists?: boolean },
  req: ClipboardIngestRequest,
): Promise<IngestResult> {
  let filedInto: string | null = null;
  if (req.listId && !bookmark.alreadyExists) {
    await addToList(req.listId, bookmark.id);
    filedInto = req.listName;
  }
  return {
    ok: true,
    bookmarkId: bookmark.id,
    alreadyExists: bookmark.alreadyExists,
    listName: filedInto,
  };
}

/**
 * Saves whatever is on the clipboard. A copied URL is fetched (an image link
 * becomes a real asset; a YouTube link becomes a bookmark the server crawls);
 * a copied bitmap goes up as-is.
 */
export async function ingestClipboard(
  req: ClipboardIngestRequest,
): Promise<IngestResult> {
  try {
    const text = (await clipboard.readText()).trim();
    if (/^https?:\/\//i.test(text)) {
      return await saveSource({ url: text, bytes: null, title: null }, req);
    }
    const bytes = await readClipboardImage();
    if (bytes) {
      return await saveSource({ url: null, bytes, title: null }, req);
    }
    return { ok: false, error: "Nothing saveable on the clipboard." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
