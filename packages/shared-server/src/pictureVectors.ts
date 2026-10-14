/**
 * Fork: comparing pictures by their fingerprints (the picture model's
 * embeddings): which are alike (duplicate pictures), which are the most like
 * one picture or a description. Brute force over all of a user's pictures —
 * a few milliseconds for thousands.
 */

export interface PictureVector {
  id: string;
  vector: Float32Array;
}

export interface AlikePair {
  a: string;
  b: string;
  distance: number;
}

/**
 * How far apart two embeddings (of length 1) point, as Immich measures it
 * (cosine distance): 0 for the same picture.
 */
export function pictureDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
}

/** The pictures within `maxDistance` of this one (never itself). */
export function alikePictures(
  picture: PictureVector,
  others: Iterable<PictureVector>,
  maxDistance: number,
): AlikePair[] {
  const found: AlikePair[] = [];
  for (const other of others) {
    if (other.id === picture.id) {
      continue;
    }
    const distance = pictureDistance(picture.vector, other.vector);
    if (distance <= maxDistance) {
      found.push({ a: picture.id, b: other.id, distance });
    }
  }
  return found;
}

/**
 * The alike pairs among `fresh`, and between `fresh` and `known` — each pair
 * once. (`known` were compared with each other before.)
 */
export function alikePairs(
  fresh: PictureVector[],
  known: PictureVector[],
  maxDistance: number,
): AlikePair[] {
  const found: AlikePair[] = [];
  fresh.forEach((picture, i) => {
    found.push(
      ...alikePictures(picture, known, maxDistance),
      ...alikePictures(picture, fresh.slice(i + 1), maxDistance),
    );
  });
  return found;
}

/** A pair as it is stored: the two ids in order, so each is kept once. */
export function orderedPair(pair: AlikePair) {
  return pair.a < pair.b
    ? { bookmarkId: pair.a, otherBookmarkId: pair.b }
    : { bookmarkId: pair.b, otherBookmarkId: pair.a };
}

/** An embedding as stored: 512 little-endian float32s. */
export function vectorToBuffer(vector: Float32Array): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((v, i) => buffer.writeFloatLE(v, i * 4));
  return buffer;
}

export function bufferToVector(buffer: Buffer): Float32Array {
  const vector = new Float32Array(buffer.length / 4);
  for (let i = 0; i < vector.length; i++) {
    vector[i] = buffer.readFloatLE(i * 4);
  }
  return vector;
}

/** A user's pictures as one block of numbers, compared in one pass. */
export interface PictureIndex {
  ids: string[];
  /** The embeddings one after another, `dims` numbers each. */
  vectors: Float32Array;
  dims: number;
}

export function buildPictureIndex(pictures: PictureVector[]): PictureIndex {
  const dims = pictures[0]?.vector.length ?? 0;
  const vectors = new Float32Array(pictures.length * dims);
  pictures.forEach((picture, i) => vectors.set(picture.vector, i * dims));
  return { ids: pictures.map((p) => p.id), vectors, dims };
}

export interface RankedPicture {
  id: string;
  /** 1 for the same direction; 1 - similarity is the distance. */
  similarity: number;
}

/**
 * What it takes to stand out from the rest of a user's pictures, for a
 * description (search by description): a word like "ring" has everything
 * round a little like it, and the rings far more.
 */
export interface StandOut {
  /** Robust standard deviations above the median of all the pictures. */
  spreads: number;
  /**
   * Or as close as this to the best match: a subject much of the library
   * shows lifts the median and the spread with it.
   */
  nearBest: number;
}

/** With fewer pictures than this, how they spread says too little. */
export const STAND_OUT_MIN_PICTURES = 100;

const middleOf = (sorted: ArrayLike<number>) => {
  const half = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[half]
    : (sorted[half - 1] + sorted[half]) / 2;
};

/**
 * Where what stands out starts among these similarities (StandOut): the
 * median plus `spreads` times 1.4826 × the median absolute deviation (a
 * standard deviation the matches themselves hardly move), or `nearBest`
 * under the best, whichever is lower. Null with too few to tell.
 */
export function standOutCutoff(
  similarities: ArrayLike<number>,
  { spreads, nearBest }: StandOut,
): number | null {
  if (similarities.length < STAND_OUT_MIN_PICTURES) {
    return null;
  }
  const sorted = Float64Array.from(similarities).sort();
  const median = middleOf(sorted);
  const deviation = middleOf(sorted.map((v) => Math.abs(v - median)).sort());
  const best = sorted[sorted.length - 1];
  return Math.min(median + spreads * 1.4826 * deviation, best - nearBest);
}

/**
 * The pictures at least `minSimilarity` like `vector`, most alike first —
 * and, with `standOut`, only those that stand out from the rest of the
 * index (standOutCutoff). Embeddings are of length 1, so the similarity is
 * their dot product.
 */
export function rankPictures(
  index: PictureIndex,
  vector: Float32Array,
  opts: {
    minSimilarity: number;
    standOut?: StandOut;
    /** Leave these out (the picture itself, say). */
    exclude?: ReadonlySet<string>;
    /** Only pictures this accepts. */
    only?: (id: string) => boolean;
    limit?: number;
  },
): RankedPicture[] {
  const { ids, vectors, dims } = index;
  if (vector.length !== dims) {
    return [];
  }
  const similarities = new Float32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    let dot = 0;
    const offset = i * dims;
    for (let d = 0; d < dims; d++) {
      dot += vectors[offset + d] * vector[d];
    }
    similarities[i] = dot;
  }
  const cutoff = opts.standOut
    ? standOutCutoff(similarities, opts.standOut)
    : null;
  const least = Math.max(opts.minSimilarity, cutoff ?? -Infinity);
  const found: RankedPicture[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (
      similarities[i] >= least &&
      !opts.exclude?.has(ids[i]) &&
      (!opts.only || opts.only(ids[i]))
    ) {
      found.push({ id: ids[i], similarity: similarities[i] });
    }
  }
  found.sort((a, b) => b.similarity - a.similarity);
  return opts.limit === undefined ? found : found.slice(0, opts.limit);
}

/**
 * Two videos whose frames look alike are the same video only if they're as
 * long too — give or take a second, or 3% of a long one. A length of 0
 * couldn't be measured: never the same.
 */
export function sameLength(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) {
    return false;
  }
  return Math.abs(a - b) <= Math.max(1, 0.03 * Math.max(a, b));
}

/** What a fingerprint is of: a picture, or a video (and its length). */
export interface FingerprintKind {
  video: boolean;
  /** Seconds; null while not measured yet. */
  duration: number | null;
}

/**
 * Whether two fingerprints can be of the same thing at all: a picture only
 * ever matches a picture, and a video a video just as long.
 */
export function sameKind(a: FingerprintKind, b: FingerprintKind): boolean {
  if (a.video !== b.video) {
    return false;
  }
  return (
    !a.video ||
    (a.duration !== null &&
      b.duration !== null &&
      sameLength(a.duration, b.duration))
  );
}
