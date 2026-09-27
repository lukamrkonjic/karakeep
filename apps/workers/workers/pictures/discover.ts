import type { PictureIndex } from "@karakeep/shared-server";
import { pictureDistance, rankPictures } from "@karakeep/shared-server";
import { DUPLICATE_MATCH_LEVELS } from "@karakeep/shared/types/duplicatePictures";
import {
  SIMILAR_LEVELS,
  SUGGESTION_LEVELS,
} from "@karakeep/shared/types/pictures";

import { suggestLists } from "./suggest";

/**
 * Fork: Discover's ranking — which of the pictures Pinterest showed under the
 * user's pins to offer, and in what order. Each one goes by its thumbnail's
 * fingerprint:
 *
 * - one the user already has (as alike as a near-duplicate to a picture of
 *   theirs) or one too like a picture they skipped is left out;
 * - the rest are scored by how like the user's own pictures they are (the
 *   mean similarity of the closest ones), less a little when near a skipped
 *   one — so skipping one keeps its kind away;
 * - near-identical ones among them count once, the best kept;
 * - each gets the list its closest pictures are in (suggest.ts), if any.
 */

/** A candidate the user has already, by its distance to theirs. */
export const ALREADY_THEIRS = DUPLICATE_MATCH_LEVELS.near;
/** Closer than this to a skipped one: left out. */
export const LIKE_SKIPPED = SIMILAR_LEVELS.close;
/** Closer than this to a skipped one: pushed down, the closer the more. */
const NEAR_SKIPPED = SIMILAR_LEVELS.related + 0.03;
const NEIGHBOURS = 10;
const LIST_MATCHES = 15;

export interface DiscoverCandidateVector {
  key: string;
  vector: Float32Array;
}

export interface RankedCandidate {
  key: string;
  score: number;
  suggestedListId: string | null;
}

export function rankCandidates(opts: {
  candidates: DiscoverCandidateVector[];
  /** The user's pictures' fingerprints. */
  library: PictureIndex;
  /** Fingerprints of the ones they skipped. */
  skipped: Float32Array[];
  listsOf: (bookmarkId: string) => readonly string[];
  parentOf: (listId: string) => string | null;
}): RankedCandidate[] {
  const { library, skipped, listsOf, parentOf } = opts;
  const scored: (RankedCandidate & { vector: Float32Array })[] = [];
  for (const candidate of opts.candidates) {
    const closest = rankPictures(library, candidate.vector, {
      minSimilarity: -1,
      limit: NEIGHBOURS,
    });
    if (closest[0] && 1 - closest[0].similarity <= ALREADY_THEIRS) {
      continue;
    }
    let nearestSkipped = Infinity;
    for (const vector of skipped) {
      nearestSkipped = Math.min(
        nearestSkipped,
        pictureDistance(candidate.vector, vector),
      );
    }
    if (nearestSkipped <= LIKE_SKIPPED) {
      continue;
    }
    const taste =
      closest.length > 0
        ? closest.reduce((sum, match) => sum + match.similarity, 0) /
          closest.length
        : 0;
    const penalty = Math.max(0, NEAR_SKIPPED - nearestSkipped);
    const [suggested] = suggestLists({
      matches: rankPictures(library, candidate.vector, {
        minSimilarity: 1 - SIMILAR_LEVELS.loose,
        only: (id) => listsOf(id).length > 0,
        limit: LIST_MATCHES,
      }),
      listsOf,
      own: new Set(),
      parentOf,
      level: SUGGESTION_LEVELS.hunch,
      max: 1,
    });
    scored.push({
      key: candidate.key,
      vector: candidate.vector,
      score: taste - penalty,
      suggestedListId: suggested?.listId ?? null,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  // The same picture pinned twice (a new copy of it, another size) once.
  const kept: typeof scored = [];
  for (const candidate of scored) {
    if (
      !kept.some(
        (k) => pictureDistance(k.vector, candidate.vector) <= ALREADY_THEIRS,
      )
    ) {
      kept.push(candidate);
    }
  }
  return kept.map(({ key, score, suggestedListId }) => ({
    key,
    score,
    suggestedListId,
  }));
}
