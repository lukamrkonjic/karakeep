/**
 * Fork: Instagram saved collections as list subscriptions. What a collection
 * link and a pasted session look like, shared so the server can reject a bad
 * one the moment it is added, with the same rules the worker fetches by.
 *
 * A collection is `https://www.instagram.com/<user>/saved/<name>/<id>/`;
 * "All posts" (everything saved) is `/<user>/saved/all-posts/` — or just
 * `/<user>/saved/`.
 */

export interface InstagramCollectionRef {
  user: string;
  /** The name in the link ("menswear", "all-posts"). */
  slug: string;
  /** Null for "All posts". */
  collectionId: string | null;
}

const INSTAGRAM_HOST = /^(?:www\.|m\.)?instagram\.com$/i;

export function parseInstagramCollectionUrl(
  raw: string,
): InstagramCollectionRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (!INSTAGRAM_HOST.test(url.hostname)) {
    return null;
  }
  const [user, saved, slug, id, ...rest] = url.pathname
    .split("/")
    .filter(Boolean);
  if (!user || saved !== "saved" || rest.length > 0) {
    return null;
  }
  if (!slug || (slug === "all-posts" && !id)) {
    return { user, slug: "all-posts", collectionId: null };
  }
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }
  return { user, slug, collectionId: id };
}

/** The one form a collection is stored in, whichever way it was linked. */
export function instagramCollectionUrl(ref: InstagramCollectionRef): string {
  return ref.collectionId
    ? `https://www.instagram.com/${ref.user}/saved/${ref.slug}/${ref.collectionId}/`
    : `https://www.instagram.com/${ref.user}/saved/all-posts/`;
}

/** "menswear" → "menswear"; "all-posts" → "All posts". */
export function instagramCollectionName(ref: InstagramCollectionRef): string {
  if (!ref.collectionId) {
    return "All posts";
  }
  try {
    return decodeURIComponent(ref.slug).replace(/[-_]+/g, " ");
  } catch {
    return ref.slug;
  }
}

/**
 * The cookies of a browser session. `sessionid` is the one that matters (it
 * is as good as the password); a csrftoken is made up when there is none.
 */
export interface InstagramCookies {
  sessionid: string;
  csrftoken?: string;
}

/**
 * Whatever was pasted: the sessionid's value (as the browser shows it, or
 * decoded), `sessionid=…`, Firefox's `sessionid:"…"`, or a whole Cookie
 * header.
 */
export function parseInstagramSession(raw: string): InstagramCookies | null {
  const text = raw
    .trim()
    .replace(/^cookie:\s*/i, "")
    // Firefox's storage panel copies a cookie as `sessionid:"…"`.
    .replace(/^sessionid\s*:\s*"?([^"]*)"?$/i, "sessionid=$1");
  const pairs = new Map<string, string>();
  if (text.includes("=")) {
    for (const part of text.split(";")) {
      const at = part.indexOf("=");
      if (at > 0) {
        pairs.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
      }
    }
  }
  const value = text.includes("=") ? pairs.get("sessionid") : text;
  if (!value) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replace(/^"|"$/g, ""));
  } catch {
    return null;
  }
  // `<user id>:<token>:<n>:<signature>`
  if (!/^\d+:[^:\s]+:/.test(decoded)) {
    return null;
  }
  const csrftoken = pairs.get("csrftoken");
  return {
    // Sent the way the browser keeps it.
    sessionid: encodeURIComponent(decoded),
    ...(csrftoken ? { csrftoken } : {}),
  };
}

/** The account a session belongs to (its sessionid starts with the id). */
export function instagramUserIdOf(cookies: InstagramCookies): string {
  return decodeURIComponent(cookies.sessionid).split(":")[0];
}
