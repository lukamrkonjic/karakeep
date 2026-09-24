import crypto from "node:crypto";

import type { InstagramCookies } from "@karakeep/shared/utils/instagram";
import { instagramUserIdOf } from "@karakeep/shared/utils/instagram";

/**
 * Fork: Instagram's web API, as instagram.com's own page calls it, with a
 * user's pasted browser session (there is no public API for saved
 * collections). The headers are the ones the page sends — and the ones
 * gallery-dl, which reads collections the same way, sends. Used by Settings
 * (checking a pasted session) and by the subscription worker.
 */

const API = "https://www.instagram.com/api/v1";
const APP_ID = "936619743392459";
const ASBD_ID = "129477";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** What secretBox seals a session under. */
export const INSTAGRAM_SESSION_PURPOSE = "instagram-session";

/** The session is no good any more: the user has to paste a fresh one. */
export class InstagramSessionError extends Error {}
/** Instagram said no for now (slow down, a hiccup): try again later. */
export class InstagramRequestError extends Error {}

/** What global fetch and the workers' fetchWithProxy both are. */
export type InstagramFetch = (
  url: string,
  init: {
    headers: Record<string, string>;
    redirect: "manual";
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export async function instagramApi(
  path: string,
  cookies: InstagramCookies,
  opts: { fetch?: InstagramFetch; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  // The page sends its csrftoken cookie back as a header; any token works as
  // long as the two match.
  const csrftoken = cookies.csrftoken ?? crypto.randomBytes(16).toString("hex");
  const doFetch = opts.fetch ?? (fetch as unknown as InstagramFetch);
  const resp = await doFetch(`${API}${path}`, {
    headers: {
      "user-agent": UA,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "x-ig-app-id": APP_ID,
      "x-asbd-id": ASBD_ID,
      "x-ig-www-claim": "0",
      "x-csrftoken": csrftoken,
      "x-requested-with": "XMLHttpRequest",
      // Without these Instagram takes it for a page visit and sends its web
      // app's HTML instead of data.
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      referer: "https://www.instagram.com/",
      cookie: `sessionid=${cookies.sessionid}; ds_user_id=${instagramUserIdOf(cookies)}; csrftoken=${csrftoken}`,
    },
    // Instagram answers a session it doesn't take with a redirect to its
    // login (or "confirm it's you") page.
    redirect: "manual",
    signal: opts.signal,
  });

  const location = resp.headers.get("location") ?? "";
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await resp.text()) as Record<string, unknown>;
  } catch {
    // not JSON: judged by the status (and a web page is no answer, below)
  }
  const message = typeof body.message === "string" ? body.message : "";

  if (/challenge|checkpoint/i.test(location) || /checkpoint/i.test(message)) {
    throw new InstagramSessionError(
      "Instagram wants you to confirm it's you. Open Instagram in your browser, then paste a fresh session in Settings → List subscriptions.",
    );
  }
  if (
    (resp.status >= 300 && resp.status < 400) ||
    resp.status === 401 ||
    message === "login_required" ||
    body.require_login === true
  ) {
    throw new InstagramSessionError(
      "Instagram signed this session out. Paste a fresh one in Settings → List subscriptions.",
    );
  }
  if (resp.status === 429 || /wait a few minutes/i.test(message)) {
    throw new InstagramRequestError(
      "Instagram asked to slow down; the next sync tries again.",
    );
  }
  if (!resp.ok || body.status === "fail") {
    throw new InstagramRequestError(
      `Instagram answered HTTP ${resp.status}${message ? `: ${message}` : ""}`,
    );
  }
  if (body.status !== "ok") {
    // A web page (or nothing) where data should be: not an answer at all.
    throw new InstagramRequestError(
      "Instagram didn't answer with data (it sent a web page instead).",
    );
  }
  return body;
}

/**
 * Whether a pasted session can read the account's saved posts (all a
 * subscription needs), and whose it is.
 */
export async function checkInstagramSession(
  cookies: InstagramCookies,
  opts: { fetch?: InstagramFetch; signal?: AbortSignal } = {},
): Promise<{ instagramUserId: string; username: string | null }> {
  const instagramUserId = instagramUserIdOf(cookies);
  await instagramApi("/feed/saved/posts/", cookies, opts);
  let username: string | null = null;
  try {
    const info = await instagramApi(
      `/users/${instagramUserId}/info/`,
      cookies,
      opts,
    );
    const user = info.user as { username?: unknown } | undefined;
    username = typeof user?.username === "string" ? user.username : null;
  } catch (error) {
    // Only the saved posts are needed; a name is nice to have.
    if (error instanceof InstagramSessionError) {
      throw error;
    }
  }
  return { instagramUserId, username };
}
