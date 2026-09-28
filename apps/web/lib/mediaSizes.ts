/**
 * Fork: the sizes of the pictures and videos this page has loaded, by asset.
 * A picture's tile in the grid loads the very file its preview shows, so the
 * preview can lay itself out at its final size on its first frame — instead
 * of opening at one size and jumping to another when the picture arrives.
 * (Karakeep stores no picture sizes.)
 *
 * Every <img> and <video> of an asset is noticed by one listener on the
 * document (installMediaSizeTracking, from the app's providers), so the grid,
 * the magnifier, "Similar" and the preview itself all fill it in.
 */

export interface MediaSize {
  w: number;
  h: number;
}

const sizes = new Map<string, MediaSize>();
// Kept for this many assets, the least recently seen going first.
const MAX_SIZES = 5000;

/** "/api/assets/abc" (any origin, any query) → "abc". */
function assetIdOf(url: string): string | null {
  return /\/api\/assets\/([^/?#]+)/.exec(url)?.[1] ?? null;
}

export function rememberMediaSize(assetId: string, w: number, h: number) {
  if (!(w > 0 && h > 0)) {
    return;
  }
  sizes.delete(assetId);
  sizes.set(assetId, { w, h });
  if (sizes.size > MAX_SIZES) {
    sizes.delete(sizes.keys().next().value!);
  }
}

export function knownMediaSize(assetId: string | undefined): MediaSize | null {
  return (assetId && sizes.get(assetId)) || null;
}

let installed = false;

/** Notices the size of every asset picture and video the page loads. */
export function installMediaSizeTracking() {
  if (installed || typeof document === "undefined") {
    return;
  }
  installed = true;
  // Neither event bubbles; both reach a capturing listener on the document.
  document.addEventListener(
    "load",
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement) {
        const id = assetIdOf(img.currentSrc || img.src);
        if (id) {
          rememberMediaSize(id, img.naturalWidth, img.naturalHeight);
        }
      }
    },
    true,
  );
  document.addEventListener(
    "loadedmetadata",
    (e) => {
      const video = e.target;
      if (video instanceof HTMLVideoElement) {
        const id = assetIdOf(video.currentSrc || video.src);
        if (id) {
          rememberMediaSize(id, video.videoWidth, video.videoHeight);
        }
      }
    },
    true,
  );
}

/**
 * A picture's size as soon as the browser knows it — at once when it's in
 * the cache, else as soon as the file's header has arrived (well before the
 * picture has). Returns a cancel.
 */
export function probeImageSize(
  src: string,
  onSize: (size: MediaSize) => void,
): () => void {
  const img = new Image();
  let frame = 0;
  let done = false;
  const check = () => {
    if (done) {
      return;
    }
    if (img.naturalWidth > 0) {
      done = true;
      const id = assetIdOf(src);
      if (id) {
        rememberMediaSize(id, img.naturalWidth, img.naturalHeight);
      }
      onSize({ w: img.naturalWidth, h: img.naturalHeight });
      return;
    }
    frame = requestAnimationFrame(check);
  };
  img.onload = check;
  img.onerror = () => {
    done = true;
    cancelAnimationFrame(frame);
  };
  img.src = src;
  check();
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    img.onload = null;
    img.onerror = null;
  };
}
