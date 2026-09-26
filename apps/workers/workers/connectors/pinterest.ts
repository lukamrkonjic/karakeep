import { fetchWithProxy } from "network";

import logger from "@karakeep/shared/logger";
import { parsePinterestBoardUrl } from "@karakeep/shared/utils/pinterest";

/**
 * Reads a PUBLIC Pinterest board.
 *
 * The board page ships its first page of pins as JSON in
 * `__PWS_INITIAL_PROPS__` (BoardResource for the board itself,
 * BoardFeedResource for the pins plus a cursor), but cut short: without
 * carousels or idea pins' pages. So every page, the first one too, comes from
 * the endpoint the site's own front-end calls, which needs the cookies, the
 * app version and the CSRF token that the page handed out, plus the name of
 * the handler it would have been called from — without them it answers
 * "Invalid Resource Request". The page's own copy is the fallback.
 *
 * Only each pin's own media is taken (`images.orig`, or an mp4 from
 * `videos.video_list` — or, for an idea pin, from its first page), so the
 * page's avatars, favicons, logos and "more like this" thumbnails never enter
 * the picture. The rest of a carousel pin's pictures, and of an idea pin's
 * pages, follow it as items of their own (`partOf` it), for subscriptions
 * that take whole carousels. A feed also carries "story" modules (related
 * interests and the like); those are skipped.
 */

import type {
  SubscriptionFetchResult,
  SubscriptionItem,
  SubscriptionMedia,
} from "./types";

export type { SubscriptionFetchResult, SubscriptionItem, SubscriptionMedia };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAGE_SIZE = 25;
// 5000 pins. Paging always runs to the end of the board: the worker needs the
// whole board to know which pins are the oldest ones it hasn't taken yet.
const MAX_PAGES = 200;
const PAGE_DELAY_MS = 250;

interface PinImage {
  url?: unknown;
  width?: unknown;
}
type PinImages = Record<string, PinImage | undefined> | null;

export interface Pin {
  id?: string;
  /** "pin" for a real pin; a board feed also carries "story" modules. */
  type?: string;
  image_signature?: unknown;
  // Which of these exist, and whether they hold a string at all, depends on
  // the field set Pinterest rendered the feed with — the grid one carries no
  // title, and a story's `title` is an object.
  grid_title?: unknown;
  title?: unknown;
  description?: unknown;
  images?: PinImages;
  videos?: { video_list?: VideoList } | null;
  /**
   * An idea pin ("story pin"): its video is on its pages, not in `videos`
   * (which is null), and the feed lists only its HLS playlist.
   */
  story_pin_data?: {
    pages?: StoryPage[] | null;
    pages_preview?: StoryPage[] | null;
  } | null;
  /**
   * A carousel pin: its pictures in order, sized up to 736 px. The pin's
   * own picture is the one at `cover_index`, though not always the same
   * file of it.
   */
  carousel_data?: {
    cover_index?: unknown;
    carousel_slots?: CarouselSlot[] | null;
  } | null;
}

type VideoList = Record<
  string,
  { url?: unknown; width?: number; thumbnail?: unknown } | undefined
>;

interface StoryPage {
  blocks?:
    | {
        video?: { video_list?: VideoList } | null;
        image?: { images?: PinImages } | null;
      }[]
    | null;
}

interface CarouselSlot {
  title?: unknown;
  images?: PinImages;
  videos?: { video_list?: VideoList } | null;
}

// An idea pin's video is also served as plain mp4s next to its playlist
// (`/videos/iht/hls/…/<id>.m3u8` → `/videos/iht/expMp4/…/<id>_720w.mp4`), in
// these widths; 720 is the largest there is.
const IDEA_PIN_MP4_WIDTHS = [720, 540, 360];

/**
 * Every Set-Cookie of a response. fetchWithProxy hands back node-fetch's
 * Response, whose headers carry `raw()`, while the platform's own carry
 * `getSetCookie()` — and `get()` would join them into one unparseable line.
 */
function setCookieHeaders(headers: {
  get(name: string): string | null;
  getSetCookie?: () => string[];
  raw?: () => Record<string, string[]>;
}): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.raw?.()["set-cookie"];
  if (raw && raw.length > 0) {
    return raw;
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function readBlob(html: string, id: string): unknown {
  const m = new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(
    html,
  );
  if (!m) {
    return null;
  }
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function firstResource(
  resources: Record<string, Record<string, unknown>> | undefined,
  name: string,
): { key: string; value: Record<string, unknown> } | null {
  const bucket = resources?.[name];
  if (!bucket) {
    return null;
  }
  const key = Object.keys(bucket)[0];
  return key ? { key, value: bucket[key] as Record<string, unknown> } : null;
}

/** The board id from a resource key: a JSON list of [option, value] pairs. */
function boardIdFromKey(key: string): string | undefined {
  try {
    const pairs = JSON.parse(key) as unknown;
    if (Array.isArray(pairs)) {
      const found = pairs.find(
        (p): p is [string, string] =>
          Array.isArray(p) && p[0] === "board_id" && typeof p[1] === "string",
      );
      return found?.[1];
    }
  } catch {
    // not the shape we know
  }
  return undefined;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** Only Pinterest's own media hosts; anything else in the JSON is ignored. */
function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".pinimg.com")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * A video's mp4s, widest first. A list's HLS playlists (.m3u8) can't be
 * stored; an idea pin's list is often nothing else, so its mp4s are worked
 * out from the playlist's address (the worker falls through to the next one,
 * and finally the cover, if one isn't there).
 */
function videoUrls(list: VideoList | undefined): string[] {
  const entries = Object.values(list ?? {}).flatMap((v) => {
    const url = mediaUrl(v?.url);
    return url ? [{ url, width: v?.width ?? 0 }] : [];
  });
  const mp4s = entries
    .filter((v) => new URL(v.url).pathname.endsWith(".mp4"))
    .sort((a, b) => b.width - a.width)
    .map((v) => v.url);
  if (mp4s.length > 0) {
    return mp4s;
  }
  const playlist = entries.find((v) =>
    /\/videos\/iht\/hls\/.+\.m3u8$/.test(new URL(v.url).pathname),
  );
  if (!playlist) {
    return [];
  }
  return IDEA_PIN_MP4_WIDTHS.map((width) =>
    playlist.url
      .replace("/videos/iht/hls/", "/videos/iht/expMp4/")
      .replace(/\.m3u8$/, `_${width}w.mp4`),
  );
}

/** An idea pin's pages (the preview's, when the feed sends only those). */
function storyPages(pin: Pin): StoryPage[] {
  const story = pin.story_pin_data;
  return story?.pages?.length ? story.pages : (story?.pages_preview ?? []);
}

/** An idea pin's video: the first one on its pages, and which page it is. */
function ideaPinVideo(pin: Pin): { list: VideoList; page: number } | null {
  for (const [page, { blocks } = {}] of storyPages(pin).entries()) {
    for (const block of blocks ?? []) {
      if (block?.video?.video_list) {
        return { list: block.video.video_list, page };
      }
    }
  }
  return null;
}

/**
 * Where a resized copy's original is: `/736x/…` → `/originals/…`. The
 * copies are always .jpg; an original can be a .png.
 */
function originalsOf(copy: string): string[] {
  const url = new URL(copy);
  const [, size, ...path] = url.pathname.split("/");
  if (!/^\d+x\d*$/.test(size ?? "") || path.length === 0) {
    return [];
  }
  url.pathname = ["", "originals", ...path].join("/");
  const original = url.toString();
  return original.endsWith(".jpg")
    ? [original, original.replace(/\.jpg$/, ".png")]
    : [original];
}

/** A picture's files, best first: its original, then its biggest copy. */
function pictureUrls(images: PinImages | undefined): string[] {
  const original =
    mediaUrl(images?.orig?.url) ?? mediaUrl(images?.originals?.url);
  let copy: { url: string; width: number } | null = null;
  for (const [size, image] of Object.entries(images ?? {})) {
    const url = mediaUrl(image?.url);
    const width = typeof image?.width === "number" ? image.width : 0;
    if (
      url &&
      size !== "orig" &&
      size !== "originals" &&
      (!copy || width > copy.width)
    ) {
      copy = { url, width };
    }
  }
  const urls = original ? [original] : copy ? originalsOf(copy.url) : [];
  if (copy && !urls.includes(copy.url)) {
    urls.push(copy.url);
  }
  return urls;
}

/** A carousel slot's, or an idea pin page's, video before its picture. */
function partMedia(
  videoList: VideoList | undefined,
  images: PinImages | undefined,
): SubscriptionMedia[] {
  const pictures = pictureUrls(images);
  if (pictures.length === 0) {
    // A video's first frame stands in for the picture it has none of.
    const frame = Object.values(videoList ?? {})
      .map((v) => mediaUrl(v?.thumbnail))
      .find((url) => url !== null);
    if (frame) {
      pictures.push(frame);
    }
  }
  return [
    ...videoUrls(videoList).map((url) => ({ kind: "video" as const, url })),
    ...pictures.map((url) => ({ kind: "image" as const, url })),
  ];
}

/** The hash Pinterest names a picture's (or a video's) files by. */
function hashOf(url: string): string | null {
  return /\/([0-9a-f]{32})[._]/.exec(new URL(url).pathname)?.[1] ?? null;
}

/** The pin's own item, and which of an idea pin's pages that is. */
function ownItemOf(pin: Pin): { item: SubscriptionItem; page: number } | null {
  if (!pin.id || (pin.type && pin.type !== "pin")) {
    return null;
  }
  const media: SubscriptionMedia[] = [];
  let page = 0;

  // Every variant of a video has the same size, and the HLS playlists
  // (.m3u8) come first — which can't be stored. The mp4 is the one to take.
  let videos = videoUrls(pin.videos?.video_list);
  if (videos.length === 0) {
    const idea = ideaPinVideo(pin);
    videos = videoUrls(idea?.list);
    if (idea && videos.length > 0) {
      page = idea.page;
    }
  }
  for (const url of videos) {
    media.push({ kind: "video", url });
  }
  // The picture itself (a video's cover, if the video can't be had).
  const orig = mediaUrl(pin.images?.orig?.url);
  if (orig) {
    media.push({ kind: "image", url: orig });
  }
  const large = mediaUrl(pin.images?.["736x"]?.url);
  if (large && large !== orig) {
    media.push({ kind: "image", url: large });
  }
  if (media.length === 0) {
    return null; // nothing of its own to keep
  }

  // The image signature is the hash Pinterest names the picture by (it is
  // the originals' file name), so it survives repins.
  const mediaKey =
    firstString(pin.image_signature) ??
    (orig
      ? (new URL(orig).pathname.split("/").pop()?.split(".")[0] ?? null)
      : null);

  return {
    item: {
      externalId: pin.id,
      mediaKey,
      title: firstString(pin.grid_title, pin.title, pin.description),
      sourceUrl: `https://www.pinterest.com/pin/${pin.id}/`,
      media,
    },
    page,
  };
}

/**
 * The rest of a carousel pin's pictures, or of an idea pin's pages: every
 * one but the pin's own, in order, each `partOf` the pin.
 */
function restOf(
  pin: Pin,
  own: SubscriptionItem,
  ownPage: number,
): SubscriptionItem[] {
  const slots = pin.carousel_data?.carousel_slots ?? [];
  let parts: { title: unknown; media: SubscriptionMedia[] }[];
  let skip: number;
  if (slots.length > 1) {
    const cover = pin.carousel_data?.cover_index;
    skip =
      typeof cover === "number" && cover >= 0 && cover < slots.length
        ? cover
        : 0;
    parts = slots.map((slot) => ({
      title: slot?.title,
      media: partMedia(slot?.videos?.video_list, slot?.images),
    }));
  } else {
    skip = ownPage;
    parts = storyPages(pin).map((page) => {
      const block = page?.blocks?.find(
        (b) => b?.video?.video_list || b?.image?.images,
      );
      return {
        title: null,
        media: partMedia(block?.video?.video_list, block?.image?.images),
      };
    });
  }
  return parts.flatMap((part, index): SubscriptionItem[] => {
    const mediaKey = part.media[0] ? hashOf(part.media[0].url) : null;
    if (
      index === skip ||
      part.media.length === 0 ||
      (mediaKey !== null && mediaKey === own.mediaKey)
    ) {
      return [];
    }
    return [
      {
        externalId: `${own.externalId}_${index + 1}`,
        mediaKey,
        title: firstString(part.title) ?? own.title,
        sourceUrl: own.sourceUrl,
        media: part.media,
        partOf: own.externalId,
      },
    ];
  });
}

/** A pin as items: its own, then the rest of a carousel or an idea pin. */
export function itemsOf(pin: Pin): SubscriptionItem[] {
  const own = ownItemOf(pin);
  return own ? [own.item, ...restOf(pin, own.item, own.page)] : [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPinterestBoard(
  boardUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SubscriptionFetchResult> {
  const parsed = parsePinterestBoardUrl(boardUrl);
  if (!parsed) {
    throw new Error(`Not a Pinterest board URL: ${boardUrl}`);
  }
  const { origin, path } = parsed;

  const pageResp = await fetchWithProxy(origin + path, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: opts.signal,
  });
  if (pageResp.status === 404) {
    throw new Error("Pinterest says this board doesn't exist");
  }
  if (!pageResp.ok) {
    throw new Error(`The board page answered HTTP ${pageResp.status}`);
  }
  const html = await pageResp.text();
  const cookies = setCookieHeaders(pageResp.headers)
    .map((c) => c.split(";")[0])
    .join("; ");
  const csrf = /csrftoken=([^;]+)/.exec(cookies)?.[1] ?? "";
  const appVersion =
    (readBlob(html, "__PWS_DATA__") as { appVersion?: string } | null)
      ?.appVersion ?? "";

  const props = readBlob(html, "__PWS_INITIAL_PROPS__") as {
    initialReduxState?: {
      resources?: Record<string, Record<string, unknown>>;
    };
  } | null;
  const resources = props?.initialReduxState?.resources;
  const board = firstResource(resources, "BoardResource");
  const feed = firstResource(resources, "BoardFeedResource");
  if (!feed) {
    throw new Error(
      "Could not read the board's pins — is the board public and the link right?",
    );
  }
  const boardData = board?.value.data as
    | { id?: string; name?: string }
    | undefined;
  const boardId = boardData?.id ?? boardIdFromKey(feed.key);

  const items: SubscriptionItem[] = [];
  const seen = new Set<string>();
  const take = (pins: Pin[]) => {
    for (const pin of pins) {
      for (const item of itemsOf(pin)) {
        if (!seen.has(item.externalId)) {
          seen.add(item.externalId);
          items.push(item);
        }
      }
    }
  };

  /**
   * A page of the board's pins, asked for the way the site's own front-end
   * does; null when Pinterest won't hand it out.
   */
  const feedPage = async (page: number, bookmark?: string) => {
    await sleep(PAGE_DELAY_MS);
    opts.signal?.throwIfAborted();
    const data = {
      options: {
        board_id: boardId,
        board_url: path,
        currentFilter: -1,
        field_set_key: "react_grid_pin",
        // As the board page itself asks: pins in sections are part of the
        // board too.
        filter_section_pins: false,
        sort: "default",
        layout: "default",
        page_size: PAGE_SIZE,
        redux_normalize_feed: true,
        ...(bookmark ? { bookmarks: [bookmark] } : {}),
      },
      context: {},
    };
    const url = `${origin}/resource/BoardFeedResource/get/?source_url=${encodeURIComponent(path)}&data=${encodeURIComponent(JSON.stringify(data))}`;
    const resp = await fetchWithProxy(url, {
      headers: {
        "user-agent": UA,
        accept: "application/json, text/javascript, */*, q=0.01",
        "accept-language": "en-US,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        "x-app-version": appVersion,
        "x-pinterest-appstate": "active",
        // Pinterest answers "Invalid Resource Request" without this: it wants
        // the name of the page its own front-end would be calling from.
        "x-pinterest-pws-handler": "www/[username]/[slug].js",
        "x-csrftoken": csrf,
        cookie: cookies,
        referer: origin + path,
      },
      signal: opts.signal,
    });
    if (!resp.ok) {
      logger.warn(
        `[subscription] Pinterest's feed answered HTTP ${resp.status} for page ${page}`,
      );
      return null;
    }
    const json = (await resp.json()) as {
      resource_response?: { data?: Pin[]; bookmark?: string };
    };
    return {
      pins: json.resource_response?.data ?? [],
      bookmark: json.resource_response?.bookmark,
    };
  };

  // The page's own copy of the first pins is cut short (no carousels, no
  // idea pins' pages): it's only what to go on if the feed won't answer.
  let first = boardId ? await feedPage(1) : null;
  if (!first?.pins.length) {
    first = {
      pins: (feed.value.data as Pin[] | undefined) ?? [],
      bookmark: feed.value.nextBookmark as string | undefined,
    };
  }
  take(first.pins);
  let bookmark = first.bookmark;
  let complete = !bookmark || bookmark === "-end-";

  for (let page = 2; !complete && page <= MAX_PAGES && boardId; page++) {
    const next = await feedPage(page, bookmark);
    if (!next) {
      // What was read so far is still worth importing; the next run tries
      // the rest again.
      break;
    }
    take(next.pins);
    bookmark = next.bookmark;
    complete = next.pins.length === 0 || !bookmark || bookmark === "-end-";
  }

  return { name: boardData?.name ?? null, items, complete };
}
