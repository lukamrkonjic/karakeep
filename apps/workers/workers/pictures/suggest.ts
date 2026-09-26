import type { RankedPicture } from "@karakeep/shared-server";

/**
 * Fork: "Belongs in…" — the lists a picture is suggested for, going by the
 * lists its closest matches are in. Each match votes for its lists, weighted
 * by how alike it is; a list gets suggested when enough of the votes, and
 * enough matches, are for it. Lists the picture is already in, or inside of,
 * aren't suggested, nor a list when one inside it is suggested too.
 */

export interface SuggestedList {
  listId: string;
  /** The share of the votes, 0–1. */
  score: number;
}

export function suggestLists(opts: {
  /** The picture's closest matches, each in at least one list. */
  matches: RankedPicture[];
  listsOf: (bookmarkId: string) => readonly string[];
  /** The lists the picture is in already. */
  own: ReadonlySet<string>;
  parentOf: (listId: string) => string | null;
  level: { share: number; count: number };
  max?: number;
}): SuggestedList[] {
  const { matches, listsOf, own, parentOf, level } = opts;
  const ancestorsOf = (listId: string) => {
    const found = new Set<string>();
    for (
      let parent = parentOf(listId);
      parent && !found.has(parent);
      parent = parentOf(parent)
    ) {
      found.add(parent);
    }
    return found;
  };
  // Lists inside of which the picture already is.
  const covered = new Set<string>();
  for (const listId of own) {
    covered.add(listId);
    ancestorsOf(listId).forEach((a) => covered.add(a));
  }

  let total = 0;
  const votes = new Map<string, { weight: number; count: number }>();
  for (const match of matches) {
    const weight = Math.max(match.similarity, 0);
    total += weight;
    for (const listId of new Set(listsOf(match.id))) {
      if (covered.has(listId)) {
        continue;
      }
      const vote = votes.get(listId) ?? { weight: 0, count: 0 };
      vote.weight += weight;
      vote.count += 1;
      votes.set(listId, vote);
    }
  }
  if (total <= 0) {
    return [];
  }

  const kept = [...votes.entries()]
    .map(([listId, vote]) => ({
      listId,
      score: vote.weight / total,
      count: vote.count,
    }))
    .filter((v) => v.score >= level.share && v.count >= level.count);
  // A list with one of its own lists suggested too gives way to it.
  const inner = new Set<string>();
  for (const { listId } of kept) {
    ancestorsOf(listId).forEach((a) => inner.add(a));
  }
  return kept
    .filter((v) => !inner.has(v.listId))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.max ?? 3)
    .map(({ listId, score }) => ({ listId, score }));
}
