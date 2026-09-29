import { describe, expect, test } from "vitest";

import { parseYouTubeList, youTubeListName, youTubeListUrl } from "./youtube";

const listOf = (raw: string) => {
  const parsed = parseYouTubeList(raw);
  return parsed && "list" in parsed ? parsed.list : parsed;
};

describe("parseYouTubeList", () => {
  test("a playlist, however it's shared", () => {
    const guitar = {
      kind: "playlist",
      id: "PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
    };
    for (const raw of [
      "https://youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm&si=4YHZfLKkHi0a76Tm",
      "https://www.youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
      "youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
      "https://m.youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
      "https://music.youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
      // A video playing in the playlist.
      "https://www.youtube.com/watch?v=oI6-8px71v0&list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm&index=2",
      "https://youtu.be/oI6-8px71v0?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
    ]) {
      expect(listOf(raw)).toEqual(guitar);
    }
    expect(youTubeListUrl(guitar as never)).toBe(
      "https://www.youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm",
    );
    expect(youTubeListName(guitar as never)).toBeNull();
  });

  test("a channel's videos", () => {
    expect(listOf("https://www.youtube.com/@kkvta")).toEqual({
      kind: "channel",
      path: "/@kkvta",
    });
    expect(listOf("https://www.youtube.com/@kkvta/shorts")).toEqual({
      kind: "channel",
      path: "/@kkvta",
    });
    const channel = listOf(
      "https://www.youtube.com/channel/UCxyz1234567890abcdefghi/videos",
    );
    expect(channel).toEqual({
      kind: "channel",
      path: "/channel/UCxyz1234567890abcdefghi",
    });
    expect(youTubeListUrl(channel as never)).toBe(
      "https://www.youtube.com/channel/UCxyz1234567890abcdefghi/videos",
    );
    expect(youTubeListName({ kind: "channel", path: "/@kkvta" })).toBe(
      "@kkvta",
    );
  });

  test("YouTube links that can't be followed say why", () => {
    const problem = (raw: string) => {
      const parsed = parseYouTubeList(raw);
      return parsed && "problem" in parsed ? parsed.problem : null;
    };
    expect(problem("https://www.youtube.com/playlist?list=WL")).toMatch(
      /Watch later is private/,
    );
    expect(problem("https://www.youtube.com/playlist?list=LL")).toMatch(
      /Liked videos/,
    );
    expect(
      problem("https://www.youtube.com/watch?v=oI6-8px71v0&list=RDoI6-8px71v0"),
    ).toMatch(/mix/);
    expect(problem("https://www.youtube.com/watch?v=oI6-8px71v0")).toMatch(
      /single video/,
    );
    expect(problem("https://youtu.be/oI6-8px71v0")).toMatch(/single video/);
    expect(problem("https://www.youtube.com/shorts/oI6-8px71v0")).toMatch(
      /single video/,
    );
    expect(problem("https://www.youtube.com/playlist")).toMatch(/no list/);
    expect(problem("https://www.youtube.com/feed/history")).toMatch(
      /isn't a playlist or a channel/,
    );
  });

  test("not YouTube at all: null", () => {
    expect(
      parseYouTubeList("https://www.pinterest.com/luka/board/"),
    ).toBeNull();
    expect(
      parseYouTubeList("https://notyoutube.com/playlist?list=PLx"),
    ).toBeNull();
    expect(parseYouTubeList("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeList("")).toBeNull();
  });
});
