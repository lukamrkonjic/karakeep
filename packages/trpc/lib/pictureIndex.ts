import { and, count, eq, isNotNull, max } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import type { PictureIndex } from "@karakeep/shared-server";
import { pictureEmbeddingsTable } from "@karakeep/db/schema";
import { bufferToVector, buildPictureIndex } from "@karakeep/shared-server";

/**
 * Fork: a user's picture fingerprints, in memory, for "More like this" and
 * search by description (routers/pictures.ts): loaded once, and again only
 * when a fingerprint was added, replaced or removed. About 2 KB a picture.
 */

interface Loaded {
  version: string;
  index: PictureIndex;
  positionOf: Map<string, number>;
}

const cache = new Map<string, Loaded>();
// Users kept; the least recently loaded goes first.
const MAX_USERS = 10;

export async function userPictureIndex(
  db: DB,
  userId: string,
): Promise<Loaded> {
  const owned = and(
    eq(pictureEmbeddingsTable.userId, userId),
    isNotNull(pictureEmbeddingsTable.embedding),
  );
  const [stamp] = await db
    .select({
      n: count(),
      latest: max(pictureEmbeddingsTable.createdAt),
    })
    .from(pictureEmbeddingsTable)
    .where(owned);
  const version = `${stamp?.n ?? 0}:${stamp?.latest?.getTime() ?? 0}`;
  const hit = cache.get(userId);
  if (hit?.version === version) {
    return hit;
  }

  const rows = await db
    .select({
      id: pictureEmbeddingsTable.bookmarkId,
      embedding: pictureEmbeddingsTable.embedding,
    })
    .from(pictureEmbeddingsTable)
    .where(owned);
  const index = buildPictureIndex(
    rows.map((r) => ({ id: r.id, vector: bufferToVector(r.embedding!) })),
  );
  const loaded: Loaded = {
    version,
    index,
    positionOf: new Map(index.ids.map((id, i) => [id, i])),
  };
  cache.delete(userId);
  cache.set(userId, loaded);
  while (cache.size > MAX_USERS) {
    cache.delete(cache.keys().next().value!);
  }
  return loaded;
}

/** A picture's own fingerprint, out of the index. */
export function vectorOf(
  loaded: Loaded,
  bookmarkId: string,
): Float32Array | null {
  const position = loaded.positionOf.get(bookmarkId);
  if (position === undefined) {
    return null;
  }
  const { vectors, dims } = loaded.index;
  return vectors.subarray(position * dims, (position + 1) * dims);
}
