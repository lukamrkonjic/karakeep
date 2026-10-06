/**
 * Fork: a YouTube video added as a link is downloaded and kept as a video
 * bookmark (apps/workers/workers/youtubeVideo.ts). Shared so the server can
 * tell one video from another however its link was shared — youtu.be, a
 * watch page with a playlist or a start time, Shorts, the phone site.
 */

const HOST = /^(?:(?:www|m|music)\.)?youtube\.com$/i;
const SHORT_HOST = /^youtu\.be$/i;
const VIDEO_ID = /^[\w-]{11}$/;
/** Paths whose next part is the video's id. */
const ID_PATHS = new Set(["shorts", "live", "embed", "v"]);

/** The video a link plays, by its 11-character id; null for anything else. */
export function youTubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const [first, second] = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined;
  if (SHORT_HOST.test(url.hostname)) {
    id = first;
  } else if (HOST.test(url.hostname)) {
    if (first === "watch") {
      id = url.searchParams.get("v");
    } else if (first && ID_PATHS.has(first)) {
      id = second;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The video's page, from its id. */
export function youTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
