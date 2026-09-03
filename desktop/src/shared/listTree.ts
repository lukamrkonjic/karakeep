import type { KarakeepList, ListNode } from "./types";

/**
 * Builds the tree: manual lists only (a smart list is a saved query, so
 * nothing can be filed into it), ordered most-recently-used first.
 *
 * `recency` is this app's own listId -> timestamp record. Lists never dropped
 * into fall back to the web app's own ordering (`position` descending), so an
 * untouched tree looks exactly like the sidebar.
 */
export function buildTree(
  lists: KarakeepList[],
  recency: Record<string, number> = {},
): ListNode[] {
  const fileable = lists.filter(
    (l) =>
      l.type === "manual" && (l.userRole === "owner" || l.userRole === "editor"),
  );
  const byId = new Map<string, ListNode>(
    fileable.map((l) => [l.id, { ...l, children: [], recencyKey: 0 }]),
  );

  const roots: ListNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // A list whose parent we filtered out (smart, or read-only) is shown at
    // the root rather than silently dropped.
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Post-order: a node's key is the newest use in its whole subtree, so a
  // parent rises when you use something inside it.
  const resolveRecency = (node: ListNode): number => {
    const own = recency[node.id] ?? 0;
    const deepest = node.children.reduce(
      (max, child) => Math.max(max, resolveRecency(child)),
      0,
    );
    node.recencyKey = Math.max(own, deepest);
    return node.recencyKey;
  };
  roots.forEach(resolveRecency);

  const sort = (nodes: ListNode[]): void => {
    nodes.sort(
      (a, b) =>
        b.recencyKey - a.recencyKey ||
        b.position - a.position ||
        a.name.localeCompare(b.name),
    );
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
