import { fetchWithProxy } from "network";

import logger from "@karakeep/shared/logger";
import { parsePinterestBoardUrl } from "@karakeep/shared/utils/pinterest";

/**
 * Reads a PUBLIC Pinterest board.
 *
 * The board page ships its first page of pins as JSON in
 * `__PWS_INITIAL_PROPS__` (BoardResource for the board itself,
 * BoardFeedResource for the pins plus a cursor). Further pages come from the
 * same endpoint the site's own front-end calls, which needs the cookies, the
 * app version and the CSRF token that the page handed out, plus the name of
 * the handler it would have been called from — without them it answers
 * "Invalid Resource Request".
 *
 * Only each pin's own media is taken (`images.orig`, or an mp4 from
 * `videos.video_list` — or, for an idea pin, from its first page), so the
 * page's avatars, favicons, logos and "more like this" thumbnails never enter
 * the picture. A feed also carries "story" modules (related interests and the
 * like); those are skipped.
 */

export interface SubscriptionMedia {
  kind: "image" | "video";
  url: string;
}

export interface SubscriptionItem {
  /** The source's id for this item (a pin id). */
  externalId: string;
  /** Identifies the picture itself, so a repin of it is still one bookmark. */
  mediaKey: string | null;
  title: string | null;
  /** The item's page, which the bookmark points back to. */
  sourceUrl: string;
  /** Best first; the worker keeps the first one that downloads. */
  media: SubscriptionMedia[];
}

export interface SubscriptionFetchResult {
  /** What the source calls itself, for the subscription's name. */
  name: string | null;
  /** In the board's order, top first. */
  items: SubscriptionItem[];
  /** False when paging stopped before the end of the board. */
  complete: boolean;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAGE_SIZE = 25;
// 5000 pins. Paging always runs to the end of the board: the worker needs the
// whole board to know which pins are the oldest ones it hasn't taken yet.
const MAX_PAGES = 200;
const PAGE_DELAY_MS = 250;

interface PinImage {
  url?: unknown;
}
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
  images?: Record<string, PinImage | undefined> | null;
  videos?: { video_list?: VideoList } | null;
  /**
   * An idea pin ("story pin"): its video is on its pages, not in `videos`
   * (which is null), and the feed lists only its HLS playlist.
   */
  story_pin_data?: {
    pages?: StoryPage[] | null;
    pages_preview?: StoryPage[] | null;
  } | null;
}

type VideoList = Record<string, { url?: unknown; width?: number } | undefined>;

interface StoryPage {
  blocks?: { video?: { video_list?: VideoList } | null }[] | null;
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

/** An idea pin's video: the first one on its pages. */
function ideaPinVideo(pin: Pin): VideoList | undefined {
  const story = pin.story_pin_data;
  for (const pages of [story?.pages, story?.pages_preview]) {
    for (const page of pages ?? []) {
      for (const block of page.blocks ?? []) {
        if (block.video?.video_list) {
          return block.video.video_list;
        }
      }
    }
  }
  return undefined;
}

export function itemOf(pin: Pin): SubscriptionItem | null {
  if (!pin.id || (pin.type && pin.type !== "pin")) {
    return null;
  }
  const media: SubscriptionMedia[] = [];

  // Every variant of a video has the same size, and the HLS playlists
  // (.m3u8) come first — which can't be stored. The mp4 is the one to take.
  const videos = videoUrls(pin.videos?.video_list);
  for (const url of videos.length > 0 ? videos : videoUrls(ideaPinVideo(pin))) {
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
    externalId: pin.id,
    mediaKey,
    title: firstString(pin.grid_title, pin.title, pin.description),
    sourceUrl: `https://www.pinterest.com/pin/${pin.id}/`,
    media,
  };
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
      const item = itemOf(pin);
      if (item && !seen.has(item.externalId)) {
        seen.add(item.externalId);
        items.push(item);
      }
    }
  };
  take((feed.value.data as Pin[] | undefined) ?? []);
  let bookmark = feed.value.nextBookmark as string | undefined;
  let complete = !bookmark || bookmark === "-end-";

  for (let page = 2; !complete && page <= MAX_PAGES && boardId; page++) {
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
        bookmarks: [bookmark],
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
      // What was read so far is still worth importing; the next run tries
      // the rest again.
      logger.warn(
        `[subscription] Pinterest paging stopped at page ${page}: HTTP ${resp.status}`,
      );
      break;
    }
    const json = (await resp.json()) as {
      resource_response?: { data?: Pin[]; bookmark?: string };
    };
    const pins = json.resource_response?.data ?? [];
    take(pins);
    bookmark = json.resource_response?.bookmark;
    complete = pins.length === 0 || !bookmark || bookmark === "-end-";
  }

  return { name: boardData?.name ?? null, items, complete };
}
