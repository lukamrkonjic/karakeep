/**
 * Fork: YouTube lists as list subscriptions — a playlist (its own link, or a
 * video's link with &list=) or a channel's videos. Shared so the server can
 * turn a link away the moment it's added, with the reason, and the web app
 * can tell a YouTube link from the others as it's typed.
 */

export type YouTubeList =
  | { kind: "playlist"; id: string }
  /** "/@handle", "/channel/UC…", "/c/name" or "/user/name". */
  | { kind: "channel"; path: string };

const HOST = /^(?:(?:www|m|music)\.)?youtube\.com$/i;
const SHORT_HOST = /^youtu\.be$/i;
const PLAYLIST_ID = /^[\w-]{10,64}$/;

/** Lists YouTube keeps to the signed-in user: the server can't read them. */
const PERSONAL: Record<string, string> = {
  WL: "Watch later",
  LL: "Liked videos",
  LM: "Liked music",
};

const ONE_VIDEO =
  "That's a single video. Paste a playlist's link (or a channel's) to follow what's added to it.";

/**
 * The list a link names: `{ list }`; a YouTube link that can't be followed:
 * `{ problem }`, saying why; anything else: null.
 */
export function parseYouTubeList(
  raw: string,
): { list: YouTubeList } | { problem: string } | null {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][\w+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const short = SHORT_HOST.test(url.hostname);
  if (!short && !HOST.test(url.hostname)) {
    return null;
  }

  const listId = url.searchParams.get("list");
  if (listId) {
    const personal = PERSONAL[listId];
    if (personal) {
      return {
        problem: `${personal} is private to your YouTube account, so the server can't read it. Put the videos in a playlist (public or unlisted) and paste its link.`,
      };
    }
    if (listId.startsWith("RD")) {
      return {
        problem:
          "That's a mix, which YouTube makes up as it plays. Save the videos to a playlist and paste its link.",
      };
    }
    return PLAYLIST_ID.test(listId)
      ? { list: { kind: "playlist", id: listId } }
      : { problem: "That playlist link looks cut short." };
  }
  if (short) {
    return { problem: ONE_VIDEO };
  }

  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (first?.startsWith("@") && first.length > 1) {
    return { list: { kind: "channel", path: `/${first}` } };
  }
  if ((first === "channel" || first === "c" || first === "user") && second) {
    return { list: { kind: "channel", path: `/${first}/${second}` } };
  }
  if (first === "playlist") {
    return { problem: "That playlist link has no list in it." };
  }
  if (["watch", "shorts", "live", "embed", "v"].includes(first ?? "")) {
    return { problem: ONE_VIDEO };
  }
  return { problem: "That YouTube link isn't a playlist or a channel." };
}

/** The link a subscription keeps: one per list, however it was pasted. */
export function youTubeListUrl(list: YouTubeList): string {
  return list.kind === "playlist"
    ? `https://www.youtube.com/playlist?list=${list.id}`
    : `https://www.youtube.com${list.path}/videos`;
}

/** A name to show till the first sync brings the real one. */
export function youTubeListName(list: YouTubeList): string | null {
  if (list.kind === "playlist") {
    return null;
  }
  const last = list.path.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The video's page, from its id. */
export function youTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
