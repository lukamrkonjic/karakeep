/**
 * Which lists show their sub-lists' items on their own page (the "…" menu's
 * toggle). Kept in a cookie rather than localStorage so the server-rendered
 * list page can build the right query straight away instead of flashing the
 * parent's own items first. No React in here: the list page imports it.
 */
export const SUBLISTS_COOKIE = "karakeep-sublists";

export function parseSublists(value?: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function serializeSublists(ids: Iterable<string>): string {
  return [...ids].join(",");
}
