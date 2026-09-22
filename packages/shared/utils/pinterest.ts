/**
 * A public Pinterest board URL, split the way the connector needs it.
 * Shared so the server can reject a bad URL the moment a subscription is
 * added, with the same rule the worker will later fetch by.
 *
 * Accepts any Pinterest domain (se.pinterest.com, pinterest.co.uk, …) and a
 * `/<user>/<board>/` path, including the board's own tool pages
 * (`/<user>/<board>/_tools/…`). Rejects a single pin, a profile or one of
 * its tabs (`/<user>/_saved/`), a board section, and anything that isn't a
 * user's page (`/ideas/…`, `/search/…`).
 */

const PINTEREST_HOST =
  /^(?:[a-z0-9-]+\.)?pinterest\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;

// First path segments that are Pinterest's own pages, not a user.
const NOT_A_USER = new Set([
  "pin",
  "search",
  "ideas",
  "today",
  "explore",
  "business",
  "settings",
  "categories",
  "topics",
  "shopping",
  "resource",
  "videos",
  "login",
  "signup",
  "password",
  "about",
]);

export function parsePinterestBoardUrl(
  raw: string,
): { origin: string; path: string; slug: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (!PINTEREST_HOST.test(url.hostname)) {
    return null;
  }
  const [user, board, sub] = url.pathname.split("/").filter(Boolean);
  if (!user || !board) {
    return null;
  }
  if (user.startsWith("_") || NOT_A_USER.has(user.toLowerCase())) {
    return null;
  }
  // `/<user>/_saved/`, `/_created/`, `/_boards/` … are tabs of a profile.
  if (board.startsWith("_")) {
    return null;
  }
  // A third segment is a board section — unless it is one of the board's
  // own tool pages, which all start with an underscore.
  if (sub && !sub.startsWith("_")) {
    return null;
  }
  return { origin: url.origin, path: `/${user}/${board}/`, slug: board };
}
