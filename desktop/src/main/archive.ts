import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ipcMain, WebContents } from "electron";

import { FetchedResource } from "../shared/types";
import { CAPTURE_WORLD } from "../shared/worlds";

/** A single resource big enough to be a mistake rather than a page asset. */
const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;
/** A capture that has run this long has hit something pathological. */
const CAPTURE_TIMEOUT_MS = 90_000;

/**
 * webContents ids with a capture in flight.
 *
 * The fetch bridge serves nobody else, so the credentialed fetch only exists
 * for the second or two after you ask for a save. Outside that window the
 * channel is closed even to the capture world.
 */
const capturing = new Set<number>();

let mainBundle: string | null = null;
let framesBundle: string | null = null;

function bundle(which: "capture" | "frames"): string {
  if (which === "capture") {
    mainBundle ??= readFileSync(
      join(__dirname, "../capture/capture.js"),
      "utf-8",
    );
    return mainBundle;
  }
  framesBundle ??= readFileSync(
    join(__dirname, "../capture/frames.js"),
    "utf-8",
  );
  return framesBundle;
}

export function registerCaptureBridge(): void {
  ipcMain.handle(
    "magpie:fetch-resource",
    async (
      event,
      url: string,
      headers: Record<string, string>,
    ): Promise<FetchedResource> => {
      if (!capturing.has(event.sender.id)) {
        throw new Error("No capture in progress");
      }
      if (!/^https?:/i.test(url)) {
        // data: and blob: URLs never reach here — SingleFile resolves those
        // itself — so anything else is a scheme we have no business fetching.
        throw new Error(`Refusing to fetch ${url.slice(0, 24)}`);
      }

      // Through the tab's own session, which is the entire point of putting a
      // browser here: cookies, proxy and cache all apply, so a logged-in
      // image comes back instead of a 403.
      const res = await event.sender.session.fetch(url, {
        headers,
        credentials: "include",
        redirect: "follow",
      });

      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_RESOURCE_BYTES) {
        throw new Error("Resource too large");
      }

      const flat: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        flat[k.toLowerCase()] = v;
      });

      return {
        status: res.status,
        url: res.url || url,
        headers: flat,
        body: new Uint8Array(buf),
      };
    },
  );
}

export interface Captured {
  html: string;
  title: string;
  url: string;
}

/**
 * Serialises the live page — scrolled, expanded, logged in — into one
 * self-contained HTML file.
 */
export async function capturePage(wc: WebContents): Promise<Captured> {
  const url = wc.getURL();
  if (!/^https?:/i.test(url)) {
    throw new Error("Only http and https pages can be archived");
  }

  capturing.add(wc.id);
  try {
    // Subframes first: the top frame's capture talks to them by message, so
    // they have to be listening before it starts.
    for (const frame of wc.mainFrame.framesInSubtree) {
      if (frame === wc.mainFrame) {
        continue;
      }
      try {
        // Only WebContents can reach an isolated world; a subframe is limited
        // to its own. That is tolerable because this script carries no
        // privilege — it serialises its frame and answers postMessage, which
        // crosses worlds either way. The credentialed fetch stays in the top
        // frame's isolated world, where a page cannot follow it.
        await frame.executeJavaScript(bundle("frames"));
      } catch {
        // A cross-origin frame that refuses injection just archives as the
        // empty box it would have been anyway. Not worth failing the page.
      }
    }

    await wc.executeJavaScriptInIsolatedWorld(CAPTURE_WORLD, [
      { code: bundle("capture") },
    ]);

    const page = (await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(CAPTURE_WORLD, [
        { code: "globalThis.__magpieCapture()" },
      ]),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Capture timed out")),
          CAPTURE_TIMEOUT_MS,
        ),
      ),
    ])) as { content: string; title: string };

    if (!page?.content) {
      throw new Error("Capture produced nothing");
    }

    // A tab that is not painting - minimised, or a window that was never
    // shown - renders nothing and lazy content never loads, so the capture
    // comes back as a megabyte of stylesheet wrapped around an empty body.
    // That is worth failing on: a silently empty archive is worse than none,
    // because it looks saved.
    const body = page.content.slice(page.content.search(/<body[\s>]/i));
    const hasText = /\w{3,}/.test(body.replace(/<[^>]*>/g, " "));
    const hasMedia = body.includes("data:image/");
    if (!hasText && !hasMedia) {
      throw new Error(
        "Capture came back empty - is the window minimised or hidden?",
      );
    }
    return {
      html: page.content,
      title: page.title || wc.getTitle(),
      url,
    };
  } finally {
    capturing.delete(wc.id);
  }
}
