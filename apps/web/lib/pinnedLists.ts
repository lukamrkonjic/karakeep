/**
 * Fork: lists pinned to the top of the sidebar — any list (a sub-list too,
 * on its own, without its parent), from its "…" → Pin. Kept in the account
 * (`pinnedLists`) in the order they were pinned, so every device shows the
 * same; lib/hooks/usePinnedLists.ts reads and sets them. No React in here.
 */

/** `pinned` with a list pinned (at the end) or unpinned. */
export function withPinned(
  pinned: string[] | undefined,
  listId: string,
  on: boolean,
): string[] {
  const rest = (pinned ?? []).filter((id) => id !== listId);
  return on ? [...rest, listId] : rest;
}
