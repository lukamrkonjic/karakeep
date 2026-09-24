/**
 * Fork: pairs of alike pictures → groups (duplicate pictures). Pictures are
 * grouped when a chain of pairs joins them: A like B and B like C make one
 * group of three, as Immich groups its duplicates.
 */
export function groupDuplicatePairs(
  pairs: { a: string; b: string; distance: number }[],
): { ids: string[]; distance: number }[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Point the path straight at the root, for the next look-up.
    while (x !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  for (const { a, b } of pairs) {
    for (const id of [a, b]) {
      if (!parent.has(id)) {
        parent.set(id, id);
      }
    }
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  }

  const groups = new Map<string, { ids: string[]; distance: number }>();
  for (const id of parent.keys()) {
    const root = find(id);
    const group = groups.get(root) ?? { ids: [], distance: 0 };
    group.ids.push(id);
    groups.set(root, group);
  }
  for (const { a, distance } of pairs) {
    const group = groups.get(find(a))!;
    group.distance = Math.max(group.distance, distance);
  }
  return [...groups.values()];
}
