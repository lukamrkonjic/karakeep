import { basename } from "node:path";
import { DropPayload, IngestRequest, IngestResult } from "../shared/types";
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

interface Media {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  fileName: string;
  sourceUrl: string | null;
}

async function downloadMedia(
  url: string,
  referer: string | null,
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

  const res = await fetch(url, { headers, redirect: "follow" });
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
 * Picks the best thing in a drop. Real bytes always beat a URL: they're
 * already local, and they can't 403.
 */
async function resolveMedia(payload: DropPayload): Promise<Media | null> {
  for (const file of payload.files) {
    const bytes = new Uint8Array(file.bytes);
    const mime = sniffMime(bytes) ?? normaliseMime(file.type) ?? "";
    if (ASSET_KIND_BY_MIME[mime]) {
      return {
        bytes,
        mime,
        fileName: fileNameFor(null, mime, file.name || "dropped"),
        sourceUrl: payload.sourcePageUrl,
      };
    }
  }

  let lastError: Error | null = null;
  for (const url of payload.urls) {
    try {
      // Browsers rarely hand a native drop the originating page URL, but most
      // hotlink checks only compare hosts — so fall back to the media's own
      // origin rather than sending no Referer at all.
      let referer = payload.sourcePageUrl;
      if (!referer && !url.startsWith("data:")) {
        try {
          referer = new URL(url).origin + "/";
        } catch {
          referer = null;
        }
      }
      const media = await downloadMedia(url, referer);
      if (media) {
        return media;
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (lastError) {
    throw lastError;
  }
  return null;
}

export async function ingest(req: IngestRequest): Promise<IngestResult> {
  const { payload, listId, listName } = req;
  try {
    let bookmark: { id: string; alreadyExists?: boolean };

    let media: Media | null = null;
    let downloadError: string | null = null;
    try {
      media = await resolveMedia(payload);
    } catch (e) {
      downloadError = e instanceof Error ? e.message : String(e);
    }

    if (media) {
      const asset = await uploadAsset(media.bytes, media.fileName, media.mime);
      bookmark = await createAssetBookmark({
        asset,
        assetType: ASSET_KIND_BY_MIME[media.mime]!,
        title: payload.title,
        sourceUrl: media.sourceUrl,
      });
    } else {
      // Nothing downloadable — fall back to a link bookmark so the drop still
      // lands somewhere and the server's crawler can have a go at it. This is
      // the usual outcome for cookie-gated media.
      const link = payload.urls[0] ?? payload.sourcePageUrl;
      if (!link) {
        const seen = payload.types.join(", ") || "nothing";
        return {
          ok: false,
          error:
            downloadError ??
            `No image or video URL in that drop (it offered: ${seen}). See the drop log in the tray menu.`,
        };
      }
      bookmark = await createLinkBookmark(link, payload.title);
    }

    let filedInto: string | null = null;
    if (listId && !bookmark.alreadyExists) {
      await addToList(listId, bookmark.id);
      filedInto = listName;
    }

    return {
      ok: true,
      bookmarkId: bookmark.id,
      alreadyExists: bookmark.alreadyExists,
      listName: filedInto,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
