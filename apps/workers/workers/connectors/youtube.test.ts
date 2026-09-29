import { promises as fs } from "fs";
import * as path from "path";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { PermanentSkip, StopRun } from "./types";

// yt-dlp: what each call answers comes from here — a list's JSON, a file
// written where -o says, or a failure as execa reports one.
type Answer =
  | { list: unknown }
  | { file: string; bytes?: number }
  | { stdout: string }
  | { fail: { stderr?: string; code?: string } };
const answers: Answer[] = [];
const calls: string[][] = [];
vi.mock("execa", () => ({
  execa: vi.fn(async (_bin: string, args: string[]) => {
    calls.push(args);
    const answer = answers.shift() ?? { stdout: "" };
    if ("fail" in answer) {
      throw Object.assign(new Error("Command failed"), answer.fail);
    }
    if ("list" in answer) {
      return { stdout: JSON.stringify(answer.list), stderr: "" };
    }
    if ("file" in answer) {
      const out = args[args.indexOf("-o") + 1];
      await fs.writeFile(
        path.join(path.dirname(out), answer.file),
        Buffer.alloc(answer.bytes ?? 1234),
      );
      return { stdout: "", stderr: "" };
    }
    return { stdout: answer.stdout, stderr: "" };
  }),
}));
vi.mock("network", () => ({
  getProxyAgent: () => undefined,
  selectRunProxies: () => ({}),
}));

const { downloadYouTubeVideo, fetchYouTubeList } = await import("./youtube");

beforeEach(() => {
  answers.length = 0;
  calls.length = 0;
});

const item = (title: string | null = "Blues in A") => ({
  externalId: "oI6-8px71v0",
  mediaKey: "yt:oI6-8px71v0",
  title,
  sourceUrl: "https://www.youtube.com/watch?v=oI6-8px71v0",
  media: [
    {
      kind: "video" as const,
      url: "https://www.youtube.com/watch?v=oI6-8px71v0",
    },
  ],
});
const signal = () => new AbortController().signal;

describe("fetchYouTubeList", () => {
  test("the videos that can be had, in the list's order, each once", async () => {
    answers.push({
      list: {
        title: "Guitar",
        entries: [
          { id: "oI6-8px71v0", title: "Jeff Beck's Strat" },
          { id: "36PjyqsSW70", title: "Timber Hearth | Cover" },
          { id: "oI6-8px71v0", title: "Jeff Beck's Strat" }, // twice
          { id: "aaaaaaaaaaa", title: "[Private video]" },
          { id: "bbbbbbbbbbb", title: null }, // deleted
          { id: "ccccccccccc", title: "Tonight", live_status: "is_upcoming" },
          {
            id: "ddddddddddd",
            title: "Members",
            availability: "subscriber_only",
          },
          { id: "too-short", title: "Not a video id" },
          {
            id: "AXlVzXizqfc",
            title: "Guthrie Govan",
            live_status: "was_live",
          },
        ],
      },
    });
    const url =
      "https://www.youtube.com/playlist?list=PLVGmWp1dChbHo85qhdu4oTP6Bfswz1phm";
    const result = await fetchYouTubeList(url);

    expect(result.name).toBe("Guitar");
    expect(result.complete).toBe(true);
    expect(result.items.map((i) => i.externalId)).toEqual([
      "oI6-8px71v0",
      "36PjyqsSW70",
      "AXlVzXizqfc",
    ]);
    expect(result.items[0]).toEqual({
      externalId: "oI6-8px71v0",
      mediaKey: "yt:oI6-8px71v0",
      title: "Jeff Beck's Strat",
      sourceUrl: "https://www.youtube.com/watch?v=oI6-8px71v0",
      media: [
        { kind: "video", url: "https://www.youtube.com/watch?v=oI6-8px71v0" },
      ],
    });
    expect(calls[0]).toContain("--flat-playlist");
    expect(calls[0].at(-1)).toBe(url);
  });

  test("a channel's name, and why a list can't be read", async () => {
    answers.push({ list: { title: "Kkvta - Videos", entries: [] } });
    expect(
      (await fetchYouTubeList("https://www.youtube.com/@kkvta/videos")).name,
    ).toBe("Kkvta");

    answers.push({
      fail: {
        stderr:
          "WARNING: something\nERROR: [youtube:tab] PLgone: The playlist does not exist.",
      },
    });
    await expect(
      fetchYouTubeList("https://www.youtube.com/playlist?list=PLgone"),
    ).rejects.toThrow(/^The playlist does not exist\.$/);
  });
});

describe("downloadYouTubeVideo", () => {
  test("at the chosen height as MP4, named after the video", async () => {
    answers.push({ file: "video.mp4", bytes: 4321 });
    const file = await downloadYouTubeVideo(item('AC/DC: "Back in Black"?'), {
      maxHeight: 720,
      signal: signal(),
    });

    expect(file).toMatchObject({
      kind: "video",
      contentType: "video/mp4",
      size: 4321,
      fileName: "AC DC Back in Black.mp4",
    });
    expect((await fs.stat(file.path)).size).toBe(4321);
    // The folder it was written in is gone; the file isn't in it.
    const out = calls[0][calls[0].indexOf("-o") + 1];
    await expect(fs.stat(path.dirname(out))).rejects.toThrow();
    await fs.unlink(file.path);

    const format = calls[0][calls[0].indexOf("-f") + 1];
    expect(format.split("/")[0]).toBe(
      "b[height<=720][vcodec^=avc1][acodec^=mp4a][protocol^=m3u8]",
    );
    expect(calls[0]).toEqual(
      expect.arrayContaining(["--merge-output-format", "mp4", "--no-playlist"]),
    );
  });

  test("360p where YouTube won't give more", async () => {
    answers.push(
      {
        fail: {
          stderr:
            "ERROR: [youtube] oI6-8px71v0: Requested format is not available",
        },
      },
      { file: "video.mp4" },
    );
    const file = await downloadYouTubeVideo(item(), {
      maxHeight: 1080,
      signal: signal(),
    });
    await fs.unlink(file.path);

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(
      expect.arrayContaining([
        "18/b[height<=360][ext=mp4]",
        "youtube:player_client=tv_simply,mweb",
      ]),
    );
  });

  test("what never works is skipped for good; what won't this run stops it", async () => {
    answers.push({
      fail: {
        stderr:
          "ERROR: [youtube] oI6-8px71v0: Private video. Sign in if you've been granted access to this video",
      },
    });
    await expect(
      downloadYouTubeVideo(item(), { maxHeight: 1080, signal: signal() }),
    ).rejects.toBeInstanceOf(PermanentSkip);
    expect(calls).toHaveLength(1); // not tried at 360p

    answers.push({
      fail: {
        stderr:
          "ERROR: [youtube] oI6-8px71v0: Sign in to confirm you’re not a bot.",
      },
    });
    await expect(
      downloadYouTubeVideo(item(), { maxHeight: 1080, signal: signal() }),
    ).rejects.toBeInstanceOf(StopRun);

    answers.push({ fail: { code: "ENOENT" } });
    await expect(
      downloadYouTubeVideo(item(), { maxHeight: 1080, signal: signal() }),
    ).rejects.toThrow(/yt-dlp isn't installed/);

    // Too big: nothing written, and yt-dlp said why.
    answers.push({
      stdout:
        "[download] File is larger than max-filesize (5000000000 bytes > 4294967296 bytes). Aborting.",
    });
    await expect(
      downloadYouTubeVideo(item(), { maxHeight: 1080, signal: signal() }),
    ).rejects.toBeInstanceOf(PermanentSkip);
  });

  test("a passing failure both ways is thrown as it is, to try next sync", async () => {
    answers.push(
      {
        fail: {
          stderr:
            "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        },
      },
      {
        fail: {
          stderr:
            "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        },
      },
    );
    const error = await downloadYouTubeVideo(item(), {
      maxHeight: 1080,
      signal: signal(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentSkip);
    expect(error).not.toBeInstanceOf(StopRun);
    expect((error as Error).message).toMatch(/403/);
  });
});
