import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { execa } from "execa";
import { getProxyAgent, selectRunProxies } from "network";

import { db } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarkLinks,
  bookmarks,
} from "@karakeep/db/schema";
import {
  ASSET_TYPES,
  newAssetId,
  QuotaService,
  saveAsset,
  saveAssetFromFile,
  silentDeleteAsset,
  StorageQuotaError,
  triggerSearchReindex,
  ZVideoRequest,
} from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { DequeuedJob } from "@karakeep/shared/queueing";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { youTubeVideoId } from "@karakeep/shared/utils/youtube";

import { grabVideoFrame } from "./assetPreprocessingWorker";

/**
 * Fork: a YouTube video added as a link (the "+", a share, the API) is
 * downloaded here and the link becomes a video bookmark — the same bookmark,
 * keeping its lists, tags, note and place, its source the link it was added
 * by — as an image or PDF link becomes its file (crawlAndParse.ts's
 * handleAsAssetBookmark). Queued once the link is crawled, or its crawl gave
 * up (shared-server queueYouTubeVideoDownload), whether or not
 * CRAWLER_VIDEO_DOWNLOAD is on. Until it's done the link says it's
 * downloading (bookmarkLinks.videoDownloadStatus); if it can't be, it stays
 * a link that says so. Its poster frame is made here, from the download, and
 * arrives with it.
 *
 * Asked for at up to 1080p as H.264 and AAC in MP4, which plays everywhere
 * (Safari too): the HLS formats first, which need no PO token, then video and
 * audio apart, merged by ffmpeg; when none of those can be had, 360p in one
 * file from the players that still give it out.
 */

const MAX_HEIGHT = 1080;
/** Far beyond a long video at 1080p: nothing bigger is kept. */
const MAX_VIDEO_MB = 4096;
/** A long video on a slow line. The video queue's runner allows for it. */
export const YOUTUBE_JOB_TIMEOUT_SECS = 30 * 60;
/** As the preprocessing worker names an uploaded video's poster frame. */
const POSTER_FILE_NAME = "video-thumbnail.jpg";

/** What a link had that a video bookmark doesn't: they go with it. */
const LINK_ASSET_TYPES = [
  AssetTypes.LINK_BANNER_IMAGE,
  AssetTypes.LINK_SCREENSHOT,
  AssetTypes.LINK_PDF,
  AssetTypes.LINK_FULL_PAGE_ARCHIVE,
  AssetTypes.LINK_PRECRAWLED_ARCHIVE,
  AssetTypes.LINK_HTML_CONTENT,
  AssetTypes.LINK_VIDEO,
  AssetTypes.LINK_VIDEO_THUMBNAIL,
];

/** Won't work however often it's tried: the link stays, saying so. */
class PermanentFailure extends Error {}

interface DownloadedVideo {
  path: string;
  dir: string;
  size: number;
  title: string | null;
  description: string | null;
}

/**
 * What every yt-dlp call is given: the server's proxy, and the admin's own
 * arguments (CRAWLER_YTDLP_ARGS, e.g. cookies) last, so they win.
 */
function reachArgs(url: string): string[] {
  const proxy = getProxyAgent(url, selectRunProxies())?.proxy.toString();
  return [
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

/** A failed yt-dlp call: never going to work, or worth another try. */
function classify(error: unknown): Error {
  const failure = error as {
    code?: unknown;
    stderr?: unknown;
    isCanceled?: unknown;
  };
  if (failure?.code === "ENOENT") {
    return new PermanentFailure("yt-dlp isn't installed on the server");
  }
  const stderr = typeof failure?.stderr === "string" ? failure.stderr : "";
  const message =
    lastError(stderr) ||
    (failure?.isCanceled
      ? "it took too long"
      : error instanceof Error
        ? error.message
        : String(error));
  if (
    /confirm your age|age-restricted|inappropriate for some users/i.test(stderr)
  ) {
    return new PermanentFailure(
      "age-restricted: YouTube only shows it to a signed-in account",
    );
  }
  if (/members-only|join this channel/i.test(stderr)) {
    return new PermanentFailure("for the channel's members only");
  }
  if (
    /private video|video unavailable|video is unavailable|has been removed|no longer available|account .*terminated|live event will begin|premieres in/i.test(
      stderr,
    )
  ) {
    return new PermanentFailure(message);
  }
  return new Error(message);
}

/** The title and description yt-dlp prints once the file is in place. */
function infoOf(
  stdout: string,
): Pick<DownloadedVideo, "title" | "description"> {
  const line = stdout.trim().split("\n").pop() ?? "";
  try {
    const info = JSON.parse(line) as { title?: unknown; description?: unknown };
    return {
      title: typeof info.title === "string" ? info.title.trim() || null : null,
      description:
        typeof info.description === "string"
          ? info.description.trim() || null
          : null,
    };
  } catch {
    return { title: null, description: null };
  }
}

/** One way of asking for the video: the file, or why not. */
async function attempt(
  url: string,
  formatArgs: string[],
  signal: AbortSignal,
): Promise<DownloadedVideo> {
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
          // Implies --quiet; "after_move" downloads all the same.
          "--print",
          "after_move:%(.{title,description})j",
          "-o",
          path.join(dir, "video.%(ext)s"),
          ...reachArgs(url),
          url,
        ],
        { cancelSignal: signal },
      ));
    } catch (error) {
      throw classify(error);
    }
    const done = (await fs.readdir(dir)).find(
      (name) => !/\.(part|ytdl|temp)$|\.part-Frag/.test(name),
    );
    if (!done) {
      throw new PermanentFailure(
        `nothing came of it (bigger than ${MAX_VIDEO_MB / 1024} GB?)`,
      );
    }
    if (path.extname(done).toLowerCase() !== ".mp4") {
      throw new Error(`came as ${path.extname(done)}, not MP4`);
    }
    const file = path.join(dir, done);
    const { size } = await fs.stat(file);
    return { path: file, dir, size, ...infoOf(stdout) };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** The video, at up to 1080p — or at 360p where YouTube won't give more. */
async function download(
  url: string,
  signal: AbortSignal,
): Promise<DownloadedVideo> {
  const h = MAX_HEIGHT;
  const ways = [
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
      return await attempt(url, way, signal);
    } catch (error) {
      if (error instanceof PermanentFailure || signal.aborted) {
        throw error;
      }
      failure = error;
    }
  }
  throw failure;
}

/** A name the file can have: the title, without what a path can't hold. */
function fileNameOf(title: string): string {
  const base =
    title
      .replace(/[/\\:*?"<>|\p{Cc}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "video";
  return `${base}.mp4`;
}

/** The link stays, saying its video couldn't be had. */
export async function markYouTubeVideoFailed(bookmarkId: string) {
  await db
    .update(bookmarkLinks)
    .set({ videoDownloadStatus: "failure" })
    .where(
      and(
        eq(bookmarkLinks.id, bookmarkId),
        eq(bookmarkLinks.videoDownloadStatus, "pending"),
      ),
    );
}

export async function runYouTubeVideoJob(job: DequeuedJob<ZVideoRequest>) {
  const jobId = job.id;
  const { bookmarkId } = job.data;

  const bookmark = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    with: { link: true },
  });
  const link = bookmark?.link;
  const videoId = link ? youTubeVideoId(link.url) : null;
  if (!bookmark || !link || !videoId) {
    logger.info(
      `[YouTube][${jobId}] Bookmark "${bookmarkId}" isn't a YouTube video's link (any more); nothing to do`,
    );
    return;
  }
  const { userId } = bookmark;

  logger.info(`[YouTube][${jobId}] Downloading "${link.url}"`);
  let video: DownloadedVideo;
  try {
    video = await download(link.url, job.abortSignal);
  } catch (error) {
    if (error instanceof PermanentFailure) {
      logger.warn(
        `[YouTube][${jobId}] Can't download "${link.url}": ${error.message}`,
      );
      await markYouTubeVideoFailed(bookmarkId);
      return;
    }
    // Tried again by the queue; the last failure marks the link (videoWorker).
    throw error;
  }

  const assetId = newAssetId();
  // Its poster frame, from the file on disk before it's stored: there the
  // moment it's a video bookmark, so the card shows it at once, and nothing
  // reads a long video into memory to make it (the preprocessing job would).
  const posterPath = path.join(video.dir, "poster.jpg");
  const poster = (await grabVideoFrame(jobId, video.path, posterPath))
    ? await fs.readFile(posterPath)
    : null;
  const posterId = newAssetId();
  const stored: string[] = [];
  try {
    const quotaApproved = await QuotaService.checkStorageQuota(
      db,
      userId,
      video.size + (poster?.byteLength ?? 0),
    );
    const title = video.title ?? link.title ?? videoId;
    const fileName = fileNameOf(title);
    await saveAssetFromFile({
      userId,
      assetId,
      assetPath: video.path,
      metadata: { contentType: ASSET_TYPES.VIDEO_MP4, fileName },
      quotaApproved,
    });
    stored.push(assetId);
    if (poster) {
      await saveAsset({
        userId,
        assetId: posterId,
        asset: poster,
        metadata: { contentType: "image/jpeg", fileName: POSTER_FILE_NAME },
        quotaApproved,
      });
      stored.push(posterId);
    }

    const replaced = db.transaction((trx) => {
      // Deleted while it downloaded: nothing to turn into a video.
      const stillALink = trx
        .select({ id: bookmarkLinks.id })
        .from(bookmarkLinks)
        .where(eq(bookmarkLinks.id, bookmarkId))
        .get();
      if (!stillALink) {
        return null;
      }
      const gone = trx
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.bookmarkId, bookmarkId),
            inArray(assets.assetType, LINK_ASSET_TYPES),
          ),
        )
        .all()
        .map((a) => a.id);
      if (gone.length) {
        trx.delete(assets).where(inArray(assets.id, gone)).run();
      }
      trx
        .insert(assets)
        .values({
          id: assetId,
          assetType: AssetTypes.BOOKMARK_ASSET,
          contentType: ASSET_TYPES.VIDEO_MP4,
          size: video.size,
          fileName,
          bookmarkId,
          userId,
        })
        .run();
      if (poster) {
        trx
          .insert(assets)
          .values({
            id: posterId,
            assetType: AssetTypes.LINK_VIDEO_THUMBNAIL,
            contentType: "image/jpeg",
            size: poster.byteLength,
            fileName: POSTER_FILE_NAME,
            bookmarkId,
            userId,
          })
          .run();
      }
      trx
        .insert(bookmarkAssets)
        .values({
          id: bookmarkId,
          assetType: "video",
          assetId,
          // Searchable, as the link's crawled text was.
          content: video.description ?? link.description,
          metadata: null,
          fileName,
          sourceUrl: link.url,
        })
        .run();
      trx.delete(bookmarkLinks).where(eq(bookmarkLinks.id, bookmarkId)).run();
      trx
        .update(bookmarks)
        .set({
          type: BookmarkTypes.ASSET,
          title: bookmark.title ?? title,
          modifiedAt: new Date(),
        })
        .where(eq(bookmarks.id, bookmarkId))
        .run();
      return gone;
    });

    if (!replaced) {
      logger.info(
        `[YouTube][${jobId}] Bookmark "${bookmarkId}" went while its video downloaded`,
      );
      await Promise.all(stored.map((id) => silentDeleteAsset(userId, id)));
      return;
    }
    await Promise.all(replaced.map((id) => silentDeleteAsset(userId, id)));

    await triggerSearchReindex(bookmarkId, { groupId: userId });
    logger.info(
      `[YouTube][${jobId}] "${link.url}" is now a video bookmark (${video.size} bytes${poster ? ", with its poster" : ", no poster"})`,
    );
  } catch (error) {
    await Promise.all(stored.map((id) => silentDeleteAsset(userId, id)));
    if (error instanceof StorageQuotaError) {
      logger.warn(
        `[YouTube][${jobId}] Not keeping "${link.url}": ${error.message}`,
      );
      await markYouTubeVideoFailed(bookmarkId);
      return;
    }
    throw error;
  } finally {
    await fs.rm(video.dir, { recursive: true, force: true });
  }
}
