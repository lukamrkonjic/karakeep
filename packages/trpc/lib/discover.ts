/**
 * Fork: Discover's picking (routers/discover.ts) — which of the user's
 * pictures they haven't seen in a while to show, going by their taste: what
 * they've saved, liked and opened lately. The taste's pictures are grouped
 * into a few kinds (spherical k-means over their fingerprints); each old
 * picture is scored by how like the nearest kind it is; the best are picked
 * with a little chance thrown in, never two near-identical ones; and a few
 * wildcards from anywhere keep it surprising.
 */

export interface Fingerprinted {
  id: string;
  /** Length 1. */
  vector: Float32Array;
  /**
   * Put before those without (1: not shown lately), the taste deciding
   * among each: the others only fill up.
   */
  bonus?: number;
}

/** Near-identical pictures: only one of them in a set. */
const NEAR = 0.06;
/** The chance thrown in, against scores that run about 0.6–0.9. */
const JITTER = 0.03;
const ROUNDS = 8;

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function normalized(vector: Float32Array): Float32Array {
  const length = Math.sqrt(dot(vector, vector)) || 1;
  return Float32Array.from(vector, (v) => v / length);
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The kinds a taste runs to: its pictures grouped (spherical k-means). */
export function tasteKinds(
  vectors: Float32Array[],
  k: number,
  random: () => number,
): Float32Array[] {
  if (vectors.length === 0 || k < 1) {
    return [];
  }
  // k-means++: each next start far from the ones before.
  const starts = [vectors[Math.floor(random() * vectors.length)]];
  while (starts.length < Math.min(k, vectors.length)) {
    const far = vectors.map(
      (v) => 1 - Math.max(...starts.map((start) => dot(v, start))),
    );
    const total = far.reduce((sum, d) => sum + Math.max(d, 0), 0);
    if (total <= 0) {
      break;
    }
    let pick = random() * total;
    let index = 0;
    for (; index < vectors.length - 1; index++) {
      pick -= Math.max(far[index], 0);
      if (pick <= 0) {
        break;
      }
    }
    starts.push(vectors[index]);
  }
  let kinds: Float32Array[] = starts.map((start) => Float32Array.from(start));
  const dims = kinds[0].length;
  for (let round = 0; round < ROUNDS; round++) {
    const sums = kinds.map(() => new Float32Array(dims));
    const counts = kinds.map(() => 0);
    for (const vector of vectors) {
      let best = 0;
      let bestDot = -Infinity;
      kinds.forEach((kind, j) => {
        const d = dot(vector, kind);
        if (d > bestDot) {
          bestDot = d;
          best = j;
        }
      });
      const sum = sums[best];
      for (let i = 0; i < dims; i++) {
        sum[i] += vector[i];
      }
      counts[best]++;
    }
    kinds = sums.map((sum, j) => (counts[j] > 0 ? normalized(sum) : kinds[j]));
  }
  return kinds;
}

/**
 * A set of `count` of the candidates, `wildcards` of them from anywhere
 * (spread through it), the rest the most like the taste.
 */
export function pickDiscoveries(opts: {
  candidates: Fingerprinted[];
  taste: Float32Array[];
  count: number;
  wildcards: number;
  random?: () => number;
}): string[] {
  const random = opts.random ?? Math.random;
  const kinds = tasteKinds(
    opts.taste,
    Math.max(1, Math.min(8, Math.round(opts.taste.length / 8))),
    random,
  );
  const ranked = opts.candidates
    .map((candidate) => ({
      ...candidate,
      // A bonus outweighs any difference of taste (similarities are ±1).
      key:
        (candidate.bonus ?? 0) * 10 +
        (kinds.length > 0
          ? Math.max(...kinds.map((kind) => dot(candidate.vector, kind)))
          : 0) +
        random() * JITTER,
    }))
    .sort((a, b) => b.key - a.key);

  const taken: Fingerprinted[] = [];
  const alikeTaken = (vector: Float32Array) =>
    taken.some((t) => 1 - dot(t.vector, vector) <= NEAR);
  const liked: Fingerprinted[] = [];
  for (const candidate of ranked) {
    if (liked.length >= opts.count - opts.wildcards) {
      break;
    }
    if (!alikeTaken(candidate.vector)) {
      liked.push(candidate);
      taken.push(candidate);
    }
  }
  const wild: Fingerprinted[] = [];
  const likedIds = new Set(liked.map((c) => c.id));
  // Any of the rest, those with a bonus first.
  for (const candidate of shuffled(
    ranked.filter((c) => !likedIds.has(c.id)),
    random,
  ).sort((a, b) => (b.bonus ?? 0) - (a.bonus ?? 0))) {
    if (wild.length >= opts.count - liked.length) {
      break;
    }
    if (!alikeTaken(candidate.vector)) {
      wild.push(candidate);
      taken.push(candidate);
    }
  }
  // The wildcards spread evenly through the set, not all at the end.
  const set = [...liked];
  const total = liked.length + wild.length;
  wild.forEach((candidate, i) => {
    set.splice(Math.round(((i + 1) * total) / (wild.length + 1)), 0, candidate);
  });
  return set.map((c) => c.id);
}
