/**
 * Caps how many feed asset tiles (images or videos) can be actively loading
 * at once, per asset kind.
 *
 * Each tile decides on its own when it's near the viewport — but with no
 * shared limit, a fast scroll through a wall of many tiles fires a burst of
 * simultaneous requests that can saturate the browser's per-origin connection
 * limit (and a modest self-hosted server's bandwidth/disk I/O), starving
 * unrelated requests (pagination, mutations, other tiles) until the backlog
 * clears. This queues excess requests instead of firing them all at once.
 */
export interface LoadGate {
  /**
   * Requests a load slot. Calls `onGranted` immediately if one is free,
   * otherwise queues it (FIFO) until one frees up. Returns a release
   * function — call it once the load completes (or the caller unmounts) to
   * free the slot for the next queued request. Safe to call more than once.
   */
  acquire(onGranted: () => void): () => void;
}

export function createLoadGate(maxConcurrent: number): LoadGate {
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

  return {
    acquire(onGranted: () => void): () => void {
      let released = false;
      let granted = false;
      const grant = () => {
        granted = true;
        onGranted();
      };

      if (active < maxConcurrent) {
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
    },
  };
}

// Images are cheap, independent requests — a modest cap prevents a burst of
// dozens firing on initial mount/fast-scroll from overwhelming the
// connection pool, while still feeling close to instant.
export const imageLoadGate = createLoadGate(6);

// Video metadata negotiation is much heavier (often requires reading deep
// into the file to find a trailing moov atom on non-"faststart" files), so
// videos get a smaller budget than images.
export const videoLoadGate = createLoadGate(2);
