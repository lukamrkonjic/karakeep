/**
 * Caps how many feed video tiles can be actively fetching metadata at once.
 *
 * Each BookmarkVideo tile has its own IntersectionObserver deciding when it's
 * near the viewport — but with no shared limit, a fast scroll through a wall
 * of many videos fires a burst of simultaneous requests that can saturate the
 * browser's per-origin connection limit, starving unrelated requests
 * (pagination, mutations, other images) until the browser works through the
 * backlog. This queues excess requests instead of firing them all at once.
 */
const MAX_CONCURRENT = 4;
let active = 0;
const waiting: (() => void)[] = [];

function releaseNext() {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) {
    active++;
    next();
  }
}

/**
 * Requests a load slot. Calls `onGranted` immediately if one is free,
 * otherwise queues it (FIFO) until one frees up. Returns a release function —
 * call it once the load completes (or the caller unmounts) to free the slot
 * for the next queued request. Safe to call more than once.
 */
export function acquireVideoLoadSlot(onGranted: () => void): () => void {
  let released = false;
  let granted = false;
  const grant = () => {
    granted = true;
    onGranted();
  };

  if (active < MAX_CONCURRENT) {
    active++;
    grant();
  } else {
    waiting.push(grant);
  }

  return () => {
    if (released) return;
    released = true;
    if (granted) {
      releaseNext();
    } else {
      const idx = waiting.indexOf(grant);
      if (idx !== -1) waiting.splice(idx, 1);
    }
  };
}
