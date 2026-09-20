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
  },
  true,
);

/*
 * There is deliberately no custom drag image here.
 *
 * A 150px card centred on the cursor looked better on paper, and it is what
 * this did for a while: clone the <img>, park the clone off-screen, hand it
 * to setDragImage. The clone never painted, though — an element parked at
 * -10000px has no rendered pixels to snapshot — so Chromium dutifully dragged
 * an empty image. Worse, it only *looked* broken where the code ran: a board
 * fell through to Chromium's own drag image and seemed fine, while a pin page
 * showed nothing at all, which is a confusing way for one bug to present.
 *
 * Chromium's default for an image drag is the image, which is exactly the
 * preview that is wanted. Making the image draggable again (above) is the
 * whole job; the drag picture then takes care of itself.
 */

let dragging = false;

// Capture phase, so this still sees the drag on a page that cancels its own
// dragstart to stop you dragging images out.
window.addEventListener(
  "dragstart",
  (e) => {
    const image = draggedImage(e);
    if (!image) {
      return;
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
    if (dragging) {
      dragging = false;
      ipcRenderer.send("magpie:drag-end");
    }
  },
  true,
);
