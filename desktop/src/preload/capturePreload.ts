import { contextBridge, ipcRenderer } from "electron";

import { CAPTURE_WORLD } from "../shared/worlds";

/**
 * Runs in every tab, at document start, in its own isolated world.
 *
 * Two jobs: it hands the page capture a privileged fetch, and it makes
 * dragging an image out of the page work.
 */

/* ---------------- the capture bridge ---------------- */

/**
 * Exposed only into the capture world — never `exposeInMainWorld`, which
 * would hand the page a fetch that carries your cookies to any origin it
 * liked. The main process also refuses this channel unless a capture it
 * started is actually in flight.
 */
contextBridge.exposeInIsolatedWorld(CAPTURE_WORLD, "__magpie", {
  fetchResource: (url: string, headers: Record<string, string>) =>
    ipcRenderer.invoke("magpie:fetch-resource", url, headers),
});

/* ---------------- the drag watcher ---------------- */

/**
 * The tray app's README gave up on dragging because sites like Pinterest put
 * nothing in the DataTransfer — the drop arrives with zero types and zero
 * files, so no drop target can recover the image. None of that matters from
 * in here: the <img> is in the DOM and its `currentSrc` is the resolved,
 * full-resolution URL the browser actually fetched. The drag's own payload is
 * never read.
 */

/** How far up to look for an image when the drag starts on a child element. */
const ANCESTOR_LIMIT = 4;

interface Dragged {
  src: string;
  title: string | null;
}

function fromElement(el: Element): Dragged | null {
  if (el instanceof HTMLImageElement) {
    // currentSrc is what the browser settled on out of srcset, so it is the
    // resolution actually on screen rather than the smallest candidate.
    const src = el.currentSrc || el.src;
    if (src) {
      return { src, title: el.alt || el.title || null };
    }
  }
  // Plenty of grids paint their image as a background on a div instead.
  const match = /url\(["']?(.+?)["']?\)/.exec(
    getComputedStyle(el).backgroundImage,
  );
  if (match?.[1] && !match[1].startsWith("data:")) {
    return { src: match[1], title: null };
  }
  return null;
}

/**
 * The image under a point, however the page has arranged things.
 *
 * `elementsFromPoint` alone is not enough: it skips anything with
 * `pointer-events: none`, which is exactly how a grid keeps its pictures from
 * swallowing clicks meant for the card. So when the stack has no image in it,
 * fall back to geometry and ask which images actually cover the point,
 * preferring the smallest — the one most specifically under the cursor rather
 * than some banner it happens to sit inside.
 */
function imageAtPoint(x: number, y: number): HTMLImageElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el instanceof HTMLImageElement) {
      return el;
    }
  }

  let best: HTMLImageElement | null = null;
  let bestArea = Infinity;
  for (const img of document.images) {
    if (!img.currentSrc && !img.src) {
      continue;
    }
    const r = img.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) {
      continue;
    }
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) {
      continue;
    }
    const area = r.width * r.height;
    if (area < bestArea) {
      best = img;
      bestArea = area;
    }
  }
  return best;
}

function draggedImage(e: DragEvent): Dragged | null {
  let el = e.target instanceof Element ? e.target : null;
  for (let i = 0; el && i < ANCESTOR_LIMIT; i++) {
    const hit = fromElement(el);
    if (hit) {
      return hit;
    }
    el = el.parentElement;
  }

  // The drag can begin on something that is not the picture and has no
  // picture above it — an overlay laid over the image, or the anchor wrapping
  // it. Ask what is actually under the cursor instead.
  const under = imageAtPoint(e.clientX, e.clientY);
  if (under) {
    const hit = fromElement(under);
    if (hit) {
      return hit;
    }
  }

  // A background-image painted on something stacked under the cursor.
  for (const other of document.elementsFromPoint(e.clientX, e.clientY)) {
    const hit = fromElement(other);
    if (hit) {
      return hit;
    }
  }

  // Last resort: a wrapper that contains the image rather than being it.
  const inner =
    e.target instanceof Element ? e.target.querySelector("img") : null;
  return inner ? fromElement(inner) : null;
}

/**
 * Pinterest marks its images `draggable="false"`, so Chromium refuses to
 * begin a drag on them at all and no dragstart ever fires — which is why a
 * pin page felt dead while a board worked. On a board the browser falls back
 * to dragging the surrounding <a>, and dropping a link on a page is a
 * navigation, which is the other half of the same bug.
 *
 * The attribute is flipped at mousedown rather than up front: the drag has
 * not begun yet, only the one element under the cursor is touched, and a
 * React re-render that puts the attribute back is simply undone again the
 * next time you reach for it. (The matching `-webkit-user-drag: none` is
 * overridden from the main process with insertCSS.)
 */
window.addEventListener(
  "mousedown",
  (e) => {
    const img = imageAtPoint(e.clientX, e.clientY);
    if (!img) {
      return;
    }
    if (img.getAttribute("draggable") === "false") {
      img.setAttribute("draggable", "true");
    }
    // The ghost is built now, not at dragstart. Chromium snapshots the drag
    // image after dragstart returns, and an <img> created during that handler
    // has had no layout or decode yet, so the snapshot comes out empty and it
    // quietly falls back to its own. A mousedown is hundreds of milliseconds
    // ahead of the drag beginning, which is all the element needs.
    prepareGhost(img);
  },
  true,
);

/** The card that rides under the cursor while you carry an image. */
const GHOST_MAX = 150;

/**
 * Chromium's own drag image is the element at its rendered size, which for a
 * full-width pin is an unwieldy slab. A small card centred on the pointer is
 * what makes it feel like picking the thing up and putting it somewhere.
 *
 * A clone of the image rather than a canvas drawn from it: the canvas would
 * be tainted by a cross-origin pin, and a tainted canvas is refused as a drag
 * image — silently, which looks exactly like the feature not working.
 */
let ghostNode: HTMLImageElement | null = null;
/** The source the standing ghost was built for. */
let ghostSrc: string | null = null;
let ghostW = 0;
let ghostH = 0;

function clearGhostNode(): void {
  ghostNode?.remove();
  ghostNode = null;
  ghostSrc = null;
}

/** Builds and lays out the ghost ahead of the drag that will use it. */
function prepareGhost(source: HTMLImageElement): void {
  const src = source.currentSrc || source.src;
  if (!src || ghostSrc === src) {
    return;
  }
  clearGhostNode();
  try {
    const ratio =
      source.naturalWidth && source.naturalHeight
        ? source.naturalWidth / source.naturalHeight
        : 1;
    ghostW = Math.round(ratio >= 1 ? GHOST_MAX : GHOST_MAX * ratio);
    ghostH = Math.round(ratio >= 1 ? GHOST_MAX / ratio : GHOST_MAX);

    const clone = document.createElement("img");
    clone.src = src;
    clone.width = ghostW;
    clone.height = ghostH;
    // Off-screen but laid out. It is never seen, and it is taken away as soon
    // as the drag it belongs to ends.
    clone.style.cssText =
      "position:fixed;top:0;left:-10000px;border-radius:10px;pointer-events:none";
    document.body.append(clone);
    // Decoding now means the snapshot has real pixels to copy later.
    void clone.decode?.().catch(() => undefined);

    ghostNode = clone;
    ghostSrc = src;
  } catch {
    clearGhostNode();
  }
}

function applyGhost(dt: DataTransfer, src: string): void {
  try {
    if (!ghostNode || ghostSrc !== src) {
      // The drag began somewhere no mousedown of ours prepared — a keyboard
      // drag, or an image found by looking under an overlay. Better a ghost
      // that may not have painted yet than none at all.
      const source = [...document.images].find(
        (i) => (i.currentSrc || i.src) === src && i.naturalWidth > 0,
      );
      if (!source) {
        return;
      }
      prepareGhost(source);
    }
    if (ghostNode) {
      dt.setDragImage(ghostNode, Math.round(ghostW / 2), Math.round(ghostH / 2));
    }
  } catch {
    // Any refusal just leaves Chromium's default drag image in place.
  }
}

let dragging = false;
/** Undoes a late listener that never ran, so it cannot fire on the next drag. */
let dropLateGhost: (() => void) | null = null;

// Capture phase, so this still sees the drag on a page that cancels its own
// dragstart to stop you dragging images out.
window.addEventListener(
  "dragstart",
  (e) => {
    const image = draggedImage(e);
    if (!image) {
      return;
    }
    const dt = e.dataTransfer;

    if (dt) {
      // Set once here and once at the very end, because neither alone is
      // enough. Chromium snapshots whatever was set last before dragstart
      // finishes dispatching, so the page can overwrite this first call — but
      // a page that stops the event propagating means a later call never
      // happens at all, and then this is the only one there is.
      applyGhost(dt, image.src);

      // Added *during* dispatch, so it joins the end of window's bubble
      // listeners: a fresh copy of that list is taken when the event reaches
      // window on the way back up, and ours is last in it by then. That is
      // what puts it after anything the page registered at load time.
      const last = (): void => {
        dropLateGhost = null;
        applyGhost(dt, image.src);
      };
      window.addEventListener("dragstart", last, { once: true });
      dropLateGhost = () => window.removeEventListener("dragstart", last);
    }

    dragging = true;
    ipcRenderer.send("magpie:drag-start", {
      src: image.src,
      title: image.title,
      pageUrl: location.href,
    });
  },
  true,
);

/**
 * While one of our drags is in flight the page must not act as a drop target.
 * Chromium's default for dropping a link or an image onto a page is to
 * navigate to it, so a drag that misses the panel would load the pin instead
 * of filing it. Missing the panel should simply mean nothing happens.
 */
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(
    type,
    (e) => {
      if (dragging) {
        e.preventDefault();
      }
    },
    true,
  );
}

window.addEventListener(
  "dragend",
  () => {
    // If the event never bubbled back to window that listener is still
    // waiting, and it must not fire on somebody else's drag.
    dropLateGhost?.();
    dropLateGhost = null;
    clearGhostNode();
    if (dragging) {
      dragging = false;
      ipcRenderer.send("magpie:drag-end");
    }
  },
  true,
);
