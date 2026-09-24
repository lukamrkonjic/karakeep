import { fetchWithProxy } from "network";

import type { InstagramFetch } from "@karakeep/shared-server";
import type { InstagramCookies } from "@karakeep/shared/utils/instagram";
import { instagramApi } from "@karakeep/shared-server";
import {
  instagramCollectionName,
  parseInstagramCollectionUrl,
} from "@karakeep/shared/utils/instagram";

import type {
  SubscriptionFetchResult,
  SubscriptionItem,
  SubscriptionMedia,
} from "./types";

/**
 * Reads one of the user's Instagram saved collections (or "All posts") with
 * their pasted session, through the endpoints instagram.com's own page uses
 * (shared-server instagram.ts) — newest save first, like the site.
 *
 * Every picture or video of a post is its own item (a carousel's each one),
 * linking back to the post. Only Instagram's own CDN is fetched from.
 *
 * Slow on purpose: a few seconds between pages, as someone scrolling would
 * be. And past the first sync it stops at the first page that holds nothing
 * new: saves arrive at the top, so everything below it is known already.
 */

/** Between pages, a random pause in this range. */
const PAGE_DELAY_MS: [number, number] = [3000, 6000];
// The API pages by 12–50 posts; this is well over any real collection.
const MAX_PAGES = 250;

interface IgCandidate {
  url?: unknown;
  width?: unknown;
}

/** The parts of Instagram's media object this reads. */
export interface IgMedia {
  code?: unknown;
  product_type?: unknown;
  caption?: { text?: unknown } | null;
  user?: { username?: unknown } | null;
  image_versions2?: { candidates?: IgCandidate[] | null } | null;
  video_versions?: IgCandidate[] | null;
  carousel_media?: IgMedia[] | null;
}

/** Only Instagram's own CDN; anything else in the JSON is ignored. */
function cdnUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname.endsWith(".cdninstagram.com") ||
        url.hostname.endsWith(".fbcdn.net"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function widestFirst(candidates: IgCandidate[] | null | undefined): string[] {
  return (candidates ?? [])
    .map((c) => ({
      url: cdnUrl(c.url),
      width: typeof c.width === "number" ? c.width : 0,
    }))
    .filter((c): c is { url: string; width: number } => !!c.url)
    .sort((a, b) => b.width - a.width)
    .map((c) => c.url);
}

/** A video (its widest file, then the next) before its cover picture. */
function mediaOf(media: IgMedia): SubscriptionMedia[] {
  const videos = widestFirst(media.video_versions)
    .slice(0, 2)
    .map((url) => ({ kind: "video" as const, url }));
  const picture = widestFirst(media.image_versions2?.candidates)[0];
  return picture ? [...videos, { kind: "image", url: picture }] : videos;
}

/** The caption's first line, or whose post it is. */
function titleOf(post: IgMedia): string | null {
  const caption =
    typeof post.caption?.text === "string" ? post.caption.text : "";
  const line = caption
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (line) {
    return line;
  }
  return typeof post.user?.username === "string"
    ? `@${post.user.username}`
    : null;
}

/** A saved post, as the pictures and videos it is made of. */
export function itemsOfPost(post: IgMedia): SubscriptionItem[] {
  const code = typeof post.code === "string" && post.code ? post.code : null;
  if (!code) {
    return [];
  }
  const page = `https://www.instagram.com/${post.product_type === "clips" ? "reel" : "p"}/${code}/`;
  const title = titleOf(post);
  const parts = post.carousel_media?.length ? post.carousel_media : [post];
  const several = parts.length > 1;
  return parts.flatMap((part, index) => {
    const media = mediaOf(part);
    if (media.length === 0) {
      return [];
    }
    // The post's code is stable, and so is a carousel's order.
    const externalId = several ? `${code}_${index + 1}` : code;
    return [
      {
        externalId,
        mediaKey: `ig:${externalId}`,
        title,
        sourceUrl: several ? `${page}?img_index=${index + 1}` : page,
        media,
      },
    ];
  });
}

async function pause(signal?: AbortSignal) {
  const [low, high] = PAGE_DELAY_MS;
  await new Promise((resolve) =>
    setTimeout(resolve, low + Math.random() * (high - low)),
  );
  signal?.throwIfAborted();
}

export async function fetchInstagramCollection(
  url: string,
  cookies: InstagramCookies,
  opts: {
    signal?: AbortSignal;
    /** Items the subscription has already handled: paging stops at a page of only those. */
    isKnown?: (externalId: string) => boolean;
  } = {},
): Promise<SubscriptionFetchResult> {
  const ref = parseInstagramCollectionUrl(url);
  if (!ref) {
    throw new Error(`Not an Instagram collection link: ${url}`);
  }
  const path = ref.collectionId
    ? `/feed/collection/${ref.collectionId}/posts/`
    : "/feed/saved/posts/";

  const items: SubscriptionItem[] = [];
  let maxId: string | null = null;
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await instagramApi(
      maxId ? `${path}?max_id=${encodeURIComponent(maxId)}` : path,
      cookies,
      {
        fetch: fetchWithProxy as unknown as InstagramFetch,
        signal: opts.signal,
      },
    );
    const entries = Array.isArray(body.items)
      ? (body.items as ({ media?: IgMedia } & IgMedia)[])
      : [];
    const pageItems = entries.flatMap((entry) =>
      itemsOfPost(entry.media ?? entry),
    );
    items.push(...pageItems);

    const next =
      typeof body.next_max_id === "string" && body.next_max_id
        ? body.next_max_id
        : null;
    if (!body.more_available || !next) {
      complete = true;
      break;
    }
    if (
      opts.isKnown &&
      pageItems.length > 0 &&
      pageItems.every((item) => opts.isKnown?.(item.externalId))
    ) {
      break;
    }
    maxId = next;
    await pause(opts.signal);
  }
  return { name: instagramCollectionName(ref), items, complete };
}
