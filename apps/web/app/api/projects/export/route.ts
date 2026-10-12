import type { NextRequest } from "next/server";
import { contentDisposition, safeFileName } from "@/lib/bookmarkFiles";
import { createContextFromRequest } from "@/server/api/client";

/**
 * Fork: a project board's "Download as PNG / JPG" (lib/downloadBookmarks.ts
 * downloadFile). The page draws the board itself and posts the picture
 * here, into a hidden frame; it comes straight back as a file to save — so
 * the browser, or the Mac/Windows app (which saves what a page is sent as
 * a download, not what it makes itself), keeps it in Downloads. Signed in
 * only; nothing is kept.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A board drawn twice over is well under this. */
const MAX_BYTES = 120 * 1024 * 1024;

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

function said(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  const context = await createContextFromRequest(request);
  if (!context.user) {
    return said("Sign in again to download.", 401);
  }
  if (context.auth?.type !== "session") {
    return said("Downloads are for the web app.", 403);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return said("Nothing to download.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return said("Nothing to download.", 400);
  }
  if (file.size > MAX_BYTES) {
    return said("That board is too big to download as one picture.", 413);
  }
  const extension = TYPES[file.type];
  if (!extension) {
    return said("Only PNG and JPG pictures download here.", 415);
  }
  const named = file.name.replace(/\.[^.]*$/, "") || "Board";
  const fileName = safeFileName(`${named}.${extension}`);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(fileName),
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
