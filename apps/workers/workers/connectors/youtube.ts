import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { execa } from "execa";
import { getProxyAgent, selectRunProxies } from "network";

import serverConfig from "@karakeep/shared/config";
import { youTubeVideoUrl } from "@karakeep/shared/utils/youtube";

import type { DownloadedFile } from "../subscriptionWorker";
import type { SubscriptionFetchResult, SubscriptionItem } from "./types";
import { PermanentSkip, StopRun } from "./types";

/**
 * Fork: YouTube playlists and channels as list subscriptions, read and
 * downloaded with yt-dlp (in the server's image, with node for YouTube's
 * scripts: docker/Dockerfile).
 *
 * A list is read flat — ids and titles, not each video's page — in its own
 * order, its first video at the top. What can't be had right now (private,
 * deleted, upcoming, live) is left out, so it's taken once it can be.
 *
 * YouTube hands out little more than 360p without a PO token (proof that a
 * real player asks). So a video is asked for at the chosen height as H.264
 * and AAC in MP4, which plays everywhere (Safari too) — the HLS formats
 * first, which need no token — and when that can't be had, at 360p: the one
 * file with both in it, which the TV and mobile players still give out.
 * With a token provider (YOUTUBE_POT_PROVIDER_URL) the chosen height comes
 * through.
 */

const VIDEO_ID = /^[\w-]{11}$/;
/** Far beyond a long video at 1080p: nothing bigger is kept. */
const MAX_VIDEO_MB = 4096;
/** One video, on a slow line. The worker's run allows for it. */
export const VIDEO_TIMEOUT_MS = 25 * 60_000;

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

interface FlatEntry {
  id?: unknown;
  title?: unknown;
  live_status?: unknown;
  availability?: unknown;
}

const NOT_YET = new Set(["is_upcoming", "is_live", "post_live"]);
const LOCKED = new Set([
  "private",
  "premium_only",
  "subscriber_only",
  "needs_auth",
]);

/** Whether a list entry is a video that can be downloaded now. */
function takeable(entry: FlatEntry): boolean {
  if (
    typeof entry.title !== "string" ||
    /^\[(private|deleted) video\]$/i.test(entry.title)
  ) {
    return false;
  }
  if (typeof entry.live_status === "string" && NOT_YET.has(entry.live_status)) {
    return false;
  }
  return !(
    typeof entry.availability === "string" && LOCKED.has(entry.availability)
  );
}

/**
 * What every yt-dlp call to YouTube is given: the token provider, the
 * server's proxy, and the admin's own arguments (CRAWLER_YTDLP_ARGS, e.g.
 * cookies) last, so they win.
 */
function reachArgs(url: string): string[] {
  const proxy = getProxyAgent(url, selectRunProxies())?.proxy.toString();
  const potUrl = serverConfig.crawler.youtubePotProviderUrl;
  return [
    ...(potUrl
      ? ["--extractor-args", `youtubepot-bgutilhttp:base_url=${potUrl}`]
      : []),
    ...(proxy ? ["--proxy", proxy] : []),
    ...serverConfig.crawler.ytDlpArguments,
  ];
}

/** yt-dlp's last error, without its "[youtube] <id>:" prefix. */
function lastError(stderr: string): string {
  const line = stderr
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("ERROR:"));
  return (line ?? "")
    .replace(/^ERROR:\s*/, "")
    .replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, "")
    .trim();
}

/**
 * A failed yt-dlp call as the worker takes it: never going to work
 * (PermanentSkip), nothing will this run (StopRun), or try again later.
 */
function classify(error: unknown): Error {
  const failure = error as {
    code?: unknown;
    stderr?: unknown;
    isCanceled?: unknown;
  };
  if (failure?.code === "ENOENT") {
    return new StopRun("yt-dlp isn't installed on the server");
  }
  const stderr = typeof failure?.stderr === "string" ? failure.stderr : "";
  const message =
    lastError(stderr) ||
    (failure?.isCanceled
      ? "it took too long"
      : error instanceof Error
        ? error.message
        : String(error));
  if (/not a bot/i.test(stderr)) {
    return new StopRun(
      "YouTube wants to be sure this isn't a bot; the next sync tries again",
    );
  }
  if (/HTTP Error 429|Too Many Requests/i.test(stderr)) {
    return new StopRun(
      "YouTube is limiting downloads for now; the next sync carries on",
    );
  }
  if (
    /confirm your age|age-restricted|inappropriate for some users/i.test(stderr)
  ) {
    return new PermanentSkip(
      "age-restricted: YouTube only shows it to a signed-in account",
    );
  }
  if (/members-only|join this channel/i.test(stderr)) {
    return new PermanentSkip("for the channel's members only");
  }
  if (
    /private video|video unavailable|video is unavailable|has been removed|no longer available|account .*terminated/i.test(
      stderr,
    )
  ) {
    return new PermanentSkip(message);
  }
  return new Error(message);
}

/**
 * A YouTube playlist or channel's videos, in its own order (its first video
 * at the top), each once.
 */
export async function fetchYouTubeList(
  listUrl: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SubscriptionFetchResult> {
  let stdout: string;
  try {
    ({ stdout } = await execa(
      "yt-dlp",
      [
        "--flat-playlist",
        "--dump-single-json",
        "--no-warnings",
        ...reachArgs(listUrl),
        listUrl,
      ],
      { cancelSignal: signal, maxBuffer: 256 * 1024 * 1024 },
    ));
  } catch (error) {
    throw classify(error);
  }
  let data: { title?: unknown; entries?: unknown };
  try {
    data = JSON.parse(stdout) as typeof data;
  } catch {
    throw new Error("yt-dlp's answer wasn't the list");
  }

  const seen = new Set<string>();
  const items: SubscriptionItem[] = [];
  for (const entry of Array.isArray(data.entries)
    ? (data.entries as FlatEntry[])
    : []) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!VIDEO_ID.test(id) || seen.has(id) || !takeable(entry)) {
      continue;
    }
    seen.add(id);
    const url = youTubeVideoUrl(id);
    items.push({
      externalId: id,
      // The same video in two lists is one bookmark, in both.
      mediaKey: `yt:${id}`,
      title: entry.title as string,
      sourceUrl: url,
      media: [{ kind: "video", url }],
    });
  }
  return {
    // A channel's videos come as "<Channel> - Videos".
    name:
      typeof data.title === "string"
        ? data.title.replace(/ - Videos$/, "") || null
        : null,
    items,
    complete: true,
  };
}

/** A name the file can have: the title, without what a path can't hold. */
function fileNameOf(item: SubscriptionItem, ext: string): string {
  const base =
    (item.title ?? "")
      .replace(/[/\\:*?"<>|\p{Cc}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || item.externalId;
  return `${base}.${ext}`;
}

/** One way of asking for the video; the file, or why not. */
async function attempt(
  item: SubscriptionItem,
  formatArgs: string[],
  signal: AbortSignal,
): Promise<DownloadedFile> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "karakeep-youtube-"));
  try {
    let stdout: string;
    try {
      ({ stdout } = await execa(
        "yt-dlp",
        [
          "--no-playlist",
          "--no-warnings",
          "--no-progress",
          ...formatArgs,
          "--merge-output-format",
          "mp4",
          "--max-filesize",
          `${MAX_VIDEO_MB}M`,
          "-o",
          path.join(dir, "video.%(ext)s"),
          ...reachArgs(item.sourceUrl),
          item.sourceUrl,
        ],
        {
          cancelSignal: AbortSignal.any([
            signal,
            AbortSignal.timeout(VIDEO_TIMEOUT_MS),
          ]),
        },
      ));
    } catch (error) {
      throw classify(error);
    }
    const [done] = (await fs.readdir(dir)).filter(
      (name) => !/\.(part|ytdl|temp)$|\.part-Frag/.test(name),
    );
    if (!done) {
      throw /larger than max-filesize/i.test(stdout)
        ? new PermanentSkip(`bigger than ${MAX_VIDEO_MB / 1024} GB`)
        : new Error("yt-dlp downloaded nothing");
    }
    const ext = path.extname(done).slice(1).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) {
      throw new PermanentSkip(`came as .${ext}, which can't be kept`);
    }
    // Out of the folder, which goes.
    const kept = path.join(
      os.tmpdir(),
      `karakeep-youtube-${randomUUID()}.${ext}`,
    );
    await fs.rename(path.join(dir, done), kept);
    const { size } = await fs.stat(kept);
    return {
      path: kept,
      kind: "video",
      contentType,
      size,
      fileName: fileNameOf(item, ext),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The video, at up to `maxHeight` pixels — or at 360p where YouTube won't
 * give more. A passing failure is thrown as is: the next sync tries again.
 */
export async function downloadYouTubeVideo(
  item: SubscriptionItem,
  { maxHeight, signal }: { maxHeight: number; signal: AbortSignal },
): Promise<DownloadedFile> {
  const h = Math.round(maxHeight);
  const ways = [
    // The HLS formats (no token needed), then video and audio apart.
    [
      "-f",
      [
        `b[height<=${h}][vcodec^=avc1][acodec^=mp4a][protocol^=m3u8]`,
        `bv*[height<=${h}][vcodec^=avc1]+ba[acodec^=mp4a]`,
        `b[height<=${h}][ext=mp4]`,
        `bv*[height<=${h}]+ba`,
        `b[height<=${h}]`,
      ].join("/"),
    ],
    // 360p in one file, from the players that still give it out.
    [
      "-f",
      "18/b[height<=360][ext=mp4]",
      "--extractor-args",
      "youtube:player_client=tv_simply,mweb",
    ],
  ];
  let failure: unknown;
  for (const way of ways) {
    try {
      return await attempt(item, way, signal);
    } catch (error) {
      if (
        error instanceof PermanentSkip ||
        error instanceof StopRun ||
        signal.aborted
      ) {
        throw error;
      }
      failure = error;
    }
  }
  throw failure;
}
