import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import {
  assetFileName,
  contentDisposition,
  internetShortcut,
  linkFileName,
  noteFileName,
  safeFileName,
  uniqueNamer,
  zipFileName,
} from "@/lib/bookmarkFiles";
import { createContextFromRequest } from "@/server/api/client";
import archiver from "archiver";
import { eq } from "drizzle-orm";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { AuthedContext } from "@karakeep/trpc";
import { assets } from "@karakeep/db/schema";
import { createAssetReadStream, getAssetSize } from "@karakeep/shared-server";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { Bookmark } from "@karakeep/trpc/models/bookmarks";

/**
 * Fork: Download, from the selection's "…" (lib/downloadBookmarks.ts). A
 * form posts `ids` (comma-separated) and `name` (the list's, for the zip).
 * One bookmark comes back as its own file; several as a zip, streamed as
 * it's made — stored, not compressed (pictures and videos don't shrink), one
 * file read at a time, so a zip of long videos costs the server no memory.
 * What each one is as a file: lib/bookmarkFiles.ts. Only bookmarks you can
 * see (`Bookmark.fromId`, as `getBookmark` — not through the API's rate
 * limit, a thousand at once being one request); what can't be had is named
 * in "Not included.txt". Signed in only (an API key's scopes aren't checked
 * here). Every answer is a file to save (fileHeaders); errors are short
 * plain text, which the page reads out of its hidden frame.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A selection is what's loaded on screen; this is plenty. */
const MAX_ITEMS = 1000;

type Entry = { name: string; date: Date } & (
  | { kind: "asset"; userId: string; assetId: string; size: number }
  | { kind: "text"; text: string }
);

function said(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function kindOf(bookmark: ZBookmark): string {
  const content = bookmark.content;
  if (content.type === BookmarkTypes.ASSET) {
    return content.assetType === "video"
      ? "Video"
      : content.assetType === "pdf"
        ? "PDF"
        : "Picture";
  }
  return content.type === BookmarkTypes.TEXT ? "Note" : "Link";
}

/** What a bookmark is as a file, or why it can't be one. */
async function entryOf(
  ctx: AuthedContext,
  bookmarkId: string,
): Promise<{ entry: Entry } | { missing: string; why: string }> {
  let bookmark: ZBookmark;
  try {
    bookmark = (await Bookmark.fromId(ctx, bookmarkId, false)).asZBookmark();
  } catch {
    return { missing: bookmarkId, why: "it isn't there any more" };
  }
  const content = bookmark.content;
  const title =
    bookmark.title ??
    (content.type === BookmarkTypes.LINK ? content.title : null);
  const date = bookmark.createdAt;

  // The file it is: a picture, video or PDF's own; a note's video; a link's
  // downloaded video (upstream's crawler video download).
  const assetId =
    content.type === BookmarkTypes.ASSET
      ? content.assetId
      : content.type === BookmarkTypes.TEXT
        ? bookmark.assets.find((a) => a.assetType === "video")?.id
        : content.type === BookmarkTypes.LINK
          ? (content.videoAssetId ?? undefined)
          : undefined;
  if (assetId) {
    const asset = await ctx.db.query.assets.findFirst({
      where: eq(assets.id, assetId),
    });
    if (asset) {
      try {
        const size = await getAssetSize({ userId: asset.userId, assetId });
        const fileName =
          asset.fileName ??
          (content.type === BookmarkTypes.ASSET ? content.fileName : null);
        return {
          entry: {
            kind: "asset",
            name: safeFileName(
              assetFileName({
                title,
                fileName,
                contentType: asset.contentType,
                fallback: `${kindOf(bookmark)} ${date.toISOString().slice(0, 10)}`,
              }),
            ),
            date,
            userId: asset.userId,
            assetId,
            size,
          },
        };
      } catch {
        // The file isn't in the asset store: a note or a link still has its
        // text below.
      }
    }
    if (content.type === BookmarkTypes.ASSET) {
      return {
        missing: title?.trim() || bookmarkId,
        why: "its file is missing",
      };
    }
  }

  if (content.type === BookmarkTypes.TEXT) {
    return {
      entry: {
        kind: "text",
        name: safeFileName(noteFileName(title, content.text)),
        date,
        text: content.text,
      },
    };
  }
  if (content.type === BookmarkTypes.LINK) {
    return {
      entry: {
        kind: "text",
        name: safeFileName(linkFileName(title, content.url)),
        date,
        text: internetShortcut(content.url),
      },
    };
  }
  return {
    missing: title?.trim() || bookmarkId,
    why: "there's nothing to download",
  };
}

/**
 * Every answer is a file to save, never a page to show: of a type no browser
 * shows — the Mac app's WebKit saves only what it can't show, whatever
 * "attachment" says — and, were it shown anyway, sandboxed with nothing
 * allowed, as the server serves its files (packages/api/utils/assets.ts).
 */
function fileHeaders(
  fileName: string,
  contentType = "application/octet-stream",
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(fileName),
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
}

/** Until the archive has taken in the entry just appended (all of it). */
function entryTaken(archive: archiver.Archiver): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      archive.off("entry", taken);
      archive.off("error", failed);
      archive.off("close", closed);
    };
    const taken = () => {
      stop();
      resolve();
    };
    const failed = (error: Error) => {
      stop();
      reject(error);
    };
    const closed = () => failed(new Error("The download was cancelled"));
    archive.on("entry", taken);
    archive.on("error", failed);
    archive.on("close", closed);
  });
}

/**
 * The zip, streamed as it's made. A cancelled download (the browser stops
 * reading, which closes the archive) or a failed one stops it wherever it
 * is — between files, in one, or finishing — and lets go of the file being
 * read.
 */
function zipOf(ctx: AuthedContext, ids: string[], name: string | undefined) {
  const archive = archiver("zip", { store: true });
  const claim = uniqueNamer();
  let reading: Readable | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    reading?.destroy();
  };
  const closed = new Promise<void>((resolve) =>
    archive.once("close", () => {
      stop();
      resolve();
    }),
  );
  archive.on("error", () => {
    stop();
    if (!archive.destroyed) {
      archive.destroy();
    }
  });

  void (async () => {
    const missing: string[] = [];
    try {
      for (const id of ids) {
        const found = await entryOf(ctx, id);
        if (stopped) {
          return;
        }
        if ("missing" in found) {
          missing.push(`${found.missing}: ${found.why}`);
          continue;
        }
        const { entry } = found;
        let source: Readable | string;
        if (entry.kind === "asset") {
          reading = (await createAssetReadStream({
            userId: entry.userId,
            assetId: entry.assetId,
          })) as Readable;
          if (stopped) {
            reading.destroy();
            return;
          }
          source = reading;
        } else {
          source = entry.text;
        }
        const taken = entryTaken(archive);
        archive.append(source, { name: claim(entry.name), date: entry.date });
        await taken;
        reading = undefined;
      }
      if (stopped) {
        return;
      }
      if (missing.length) {
        archive.append(
          `Not in this download:\r\n\r\n${missing.join("\r\n")}\r\n`,
          { name: claim("Not included.txt") },
        );
      }
      await Promise.race([archive.finalize(), closed]);
    } catch (error) {
      reading?.destroy();
      if (!archive.destroyed) {
        archive.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  })();

  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: fileHeaders(zipFileName(name, ids.length), "application/zip"),
  });
}

export async function POST(request: NextRequest) {
  const context = await createContextFromRequest(request);
  if (!context.user) {
    return said("Sign in again to download.", 401);
  }
  // The web app's own: an API key's scopes aren't checked here.
  if (context.auth?.type !== "session") {
    return said("Downloads are for the web app.", 403);
  }
  const ctx = context as AuthedContext;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return said("Nothing to download.", 400);
  }
  const ids = [
    ...new Set(
      String(form.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    return said("Nothing to download.", 400);
  }
  if (ids.length > MAX_ITEMS) {
    return said(`At most ${MAX_ITEMS} at a time.`, 400);
  }
  const name = String(form.get("name") ?? "").trim() || undefined;

  if (ids.length > 1) {
    return zipOf(ctx, ids, name);
  }

  // One: the file itself.
  const found = await entryOf(ctx, ids[0]);
  if ("missing" in found) {
    return said(`Couldn't download it — ${found.why}.`, 404);
  }
  const { entry } = found;
  if (entry.kind === "text") {
    return new Response(entry.text, { headers: fileHeaders(entry.name) });
  }
  let file: Readable;
  try {
    file = (await createAssetReadStream({
      userId: entry.userId,
      assetId: entry.assetId,
    })) as Readable;
  } catch {
    return said("Couldn't download it — its file can't be read.", 500);
  }
  return new Response(Readable.toWeb(file) as ReadableStream, {
    headers: {
      ...fileHeaders(entry.name),
      "Content-Length": String(entry.size),
    },
  });
}
