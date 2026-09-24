/**
 * Fork: which pictures are alike (duplicate pictures). Brute force over all
 * of a user's pictures — a few milliseconds per picture for thousands.
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
