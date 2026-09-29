/**
 * Fork: how a name matches what's typed (lower case): 0 at its start, 1 at
 * a word's start, 2 inside a word; -1 not at all. The search bar's
 * suggestions and Quick find rank by it (then the shorter name).
 */
export function matchRank(name: string, term: string): number {
  const lower = name.toLowerCase();
  const at = lower.indexOf(term);
  if (at < 0) {
    return -1;
  }
  if (at === 0) {
    return 0;
  }
  return lower.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(term))
    ? 1
    : 2;
}
