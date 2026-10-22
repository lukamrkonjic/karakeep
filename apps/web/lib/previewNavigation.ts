"use client";

import { useRouter } from "next/navigation";

/**
 * Fork: a bookmark's preview opens in place. The address changes
 * (history.pushState, which Next's router follows: usePathname sees it,
 * Back closes it) but nothing is navigated to, so the page under it — and
 * where it was scrolled to — stays as it is, and no server answer is waited
 * for. A route navigation could fall back to loading the preview as a page
 * of its own: when the server is restarting, slow, or running a newer build
 * than the open tab (the NAS pulls new images on its own). PreviewHost, in
 * the dashboard's and settings' layouts, shows it.
 *
 * Only a page with a PreviewHost opens it in place; anywhere else (and for a
 * new tab) it's the ordinary link to the preview's own page.
 */

const PREVIEW_PATH = /^\/dashboard\/preview\/([^/?#]+)\/?$/;

/**
 * Marks the history entries opened in place, by this page load: after a
 * reload the browser keeps the entry's state, but the preview is then the
 * page itself.
 */
const LOAD_ID = Math.random().toString(36).slice(2);

let hosts = 0;

/** PreviewHost's: while one is mounted, previews open in place. */
export function registerPreviewHost(): () => void {
  hosts++;
  return () => {
    hosts--;
  };
}

/** The bookmark whose preview `path` is, if it is one. */
export function previewIdOf(path: string | null): string | null {
  return PREVIEW_PATH.exec(path ?? "")?.[1] ?? null;
}

/** Whether the current history entry is a preview opened in place. */
export function isPreviewInPlace(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.history.state as { vranaPreview?: string } | null)?.vranaPreview ===
      LOAD_ID
  );
}

/**
 * Opens the preview at `href` in place; false when it can't be (no host, not
 * a preview, or the preview is the page itself), for a navigation instead.
 */
export function openPreviewInPlace(href: string, replace = false): boolean {
  if (hosts === 0 || typeof window === "undefined") {
    return false;
  }
  const url = new URL(href, window.location.href);
  if (
    url.origin !== window.location.origin ||
    previewIdOf(url.pathname) === null
  ) {
    return false;
  }
  // The preview's own page (loaded as one): it navigates as it always did.
  if (previewIdOf(window.location.pathname) !== null && !isPreviewInPlace()) {
    return false;
  }
  const state = { vranaPreview: LOAD_ID };
  const target = url.pathname + url.search + url.hash;
  if (replace) {
    window.history.replaceState(state, "", target);
  } else {
    window.history.pushState(state, "", target);
  }
  return true;
}

/** Opens a preview: in place when it can be, else by navigating there. */
export function useOpenPreview() {
  const router = useRouter();
  return (
    href: string,
    opts: { replace?: boolean; scroll?: boolean } = {},
  ): void => {
    if (openPreviewInPlace(href, opts.replace)) {
      return;
    }
    const scroll = opts.scroll ?? true;
    if (opts.replace) {
      router.replace(href, { scroll });
    } else {
      router.push(href, { scroll });
    }
  };
}
