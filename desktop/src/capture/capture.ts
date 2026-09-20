import * as singlefile from "single-file-core/single-file.js";

import type { FetchedResource } from "../shared/types";

/**
 * Injected into the capture world of the top frame. Everything here runs with
 * the page's DOM but its own JavaScript context, so the page cannot see or
 * replace any of it — including the privileged fetch below.
 */

declare const __magpie: {
  fetchResource(
    url: string,
    headers: Record<string, string>,
  ): Promise<FetchedResource>;
};

/**
 * SingleFile only ever asks a response for `status`, `url`, `headers.get()`
 * and `arrayBuffer()`, so the bridge ships plain data and the Response shape
 * is rebuilt here rather than trying to send a real one across IPC.
 */
function asResponse(r: FetchedResource) {
  return {
    status: r.status,
    url: r.url,
    headers: {
      get: (name: string) => r.headers[name.toLowerCase()] ?? null,
    },
    arrayBuffer: async () => {
      // The IPC copy is a view over a larger buffer often enough that handing
      // out `.buffer` directly would leak neighbouring resources into it.
      const copy = new Uint8Array(r.body.byteLength);
      copy.set(r.body);
      return copy.buffer;
    },
  };
}

async function bridgeFetch(
  url: string,
  options?: { headers?: Record<string, string> },
) {
  return asResponse(await __magpie.fetchResource(url, options?.headers ?? {}));
}

const OPTIONS = {
  // The sites this browser exists for hold their best images behind a lazy
  // loader, so the wait to let them in is the point.
  loadDeferredContent: true,
  loadDeferredContentMaxIdleTime: 2500,

  // An archive is a document, not a program: scripts left in it would run
  // against whatever the web looks like on the day it is read.
  blockScripts: true,
  blockMixedContent: true,
  insertMetaCSP: true,

  // Off on purpose. It decides what is hidden from computed layout, and a
  // tab that is not painting — a background tab, or a window that was never
  // shown — reports everything as hidden and the archive comes back as an
  // empty body with a megabyte of CSS. Bigger archives beat empty ones.
  removeHiddenElements: false,
  removeUnusedFonts: true,
  compressHTML: true,

  saveFavicon: true,
  saveOriginalURLs: true,
  insertCanonicalLink: true,
  insertSingleFileComment: true,
  resolveLinks: true,

  // Subframes get their own injection, so they can be kept.
  removeFrames: false,

  // There is no userscript hook without SingleFile's document-start
  // bootstrap, and leaving this on makes the capture wait for an answer that
  // is never coming.
  userScriptEnabled: false,

  networkTimeout: 20000,
  maxResourceSizeEnabled: true,
  maxResourceSize: 20,

  saveDate: new Date(),
  visitDate: new Date(),
};

async function capture(): Promise<{ content: string; title: string }> {
  const page = await singlefile.getPageData(OPTIONS, {
    fetch: bridgeFetch,
    frameFetch: bridgeFetch,
  });
  return { content: page.content, title: page.title ?? "" };
}

(globalThis as unknown as Record<string, unknown>).__magpieCapture = capture;
