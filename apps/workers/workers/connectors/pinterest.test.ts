import { describe, expect, test, vi } from "vitest";

import type { Pin } from "./pinterest";
import { itemsOf } from "./pinterest";

// Reading a pin fetches nothing; the board fetcher's network isn't needed.
vi.mock("network", () => ({ fetchWithProxy: vi.fn() }));

const cover = {
  orig: { url: "https://i.pinimg.com/originals/67/0d/34/cover.jpg" },
};

describe("Pinterest pins", () => {
  test("a picture is its original image", () => {
    const [item] = itemsOf({ id: "1", type: "pin", images: cover });
    expect(item?.media).toEqual([
      {
        kind: "image",
        url: "https://i.pinimg.com/originals/67/0d/34/cover.jpg",
      },
    ]);
  });

  test("a video pin takes its widest mp4, never the HLS playlist", () => {
    const pin: Pin = {
      id: "2",
      type: "pin",
      images: cover,
      videos: {
        video_list: {
          V_HLSV4: {
            url: "https://v1.pinimg.com/videos/mc/hls/ab/cd/ef/x.m3u8",
            width: 720,
          },
          V_720P: {
            url: "https://v1.pinimg.com/videos/mc/720p/ab/cd/ef/x.mp4",
            width: 720,
          },
          V_480P: {
            url: "https://v1.pinimg.com/videos/mc/480p/ab/cd/ef/x.mp4",
            width: 480,
          },
        },
      },
    };
    expect(itemsOf(pin)[0]?.media.map((m) => m.url)).toEqual([
      "https://v1.pinimg.com/videos/mc/720p/ab/cd/ef/x.mp4",
      "https://v1.pinimg.com/videos/mc/480p/ab/cd/ef/x.mp4",
      "https://i.pinimg.com/originals/67/0d/34/cover.jpg",
    ]);
  });

  // An idea pin: `videos` is null, and its page lists only a playlist.
  test("an idea pin's video comes from the mp4s beside its playlist", () => {
    const pin: Pin = {
      id: "3",
      type: "pin",
      images: cover,
      videos: null,
      story_pin_data: {
        pages: [
          {
            blocks: [
              {
                video: {
                  video_list: {
                    V_HLSV3_MOBILE: {
                      url: "https://v1.pinimg.com/videos/iht/hls/67/0d/34/670d34df.m3u8",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    };
    expect(itemsOf(pin)[0]?.media).toEqual([
      {
        kind: "video",
        url: "https://v1.pinimg.com/videos/iht/expMp4/67/0d/34/670d34df_720w.mp4",
      },
      {
        kind: "video",
        url: "https://v1.pinimg.com/videos/iht/expMp4/67/0d/34/670d34df_540w.mp4",
      },
      {
        kind: "video",
        url: "https://v1.pinimg.com/videos/iht/expMp4/67/0d/34/670d34df_360w.mp4",
      },
      {
        kind: "image",
        url: "https://i.pinimg.com/originals/67/0d/34/cover.jpg",
      },
    ]);
  });
});

// As the board feed sends them (seen on Wayfair's boards, 2026-09-26).
const hash = (n: number) => `${n}`.padStart(32, "a");
const sized = (size: string, n: number) =>
  `https://i.pinimg.com/${size}/aa/aa/aa/${hash(n)}.jpg`;
const slotImages = (n: number) => ({
  "236x": { url: sized("236x", n), width: 236 },
  "736x": { url: sized("736x", n), width: 736 },
  "600x315": { url: sized("600x315", n), width: 600 },
});

describe("Pinterest carousels and idea pins", () => {
  test("a carousel pin: its cover, then the other pictures, each a part of it", () => {
    const items = itemsOf({
      id: "7",
      type: "pin",
      grid_title: "Dark decor",
      image_signature: hash(90),
      images: { orig: { url: sized("originals", 90) } },
      carousel_data: {
        cover_index: 0,
        // The cover is the first picture, as another file of it.
        carousel_slots: [
          { images: slotImages(1) },
          { images: slotImages(2), title: "Moody lamps" },
          { images: slotImages(3) },
        ],
      },
    });
    expect(items.map((i) => [i.externalId, i.partOf, i.title])).toEqual([
      ["7", undefined, "Dark decor"],
      ["7_2", "7", "Moody lamps"],
      ["7_3", "7", "Dark decor"],
    ]);
    // The original, which may be a .png, before the biggest copy.
    expect(items[1]).toMatchObject({
      mediaKey: hash(2),
      sourceUrl: "https://www.pinterest.com/pin/7/",
      media: [
        { kind: "image", url: sized("originals", 2) },
        {
          kind: "image",
          url: sized("originals", 2).replace(/\.jpg$/, ".png"),
        },
        { kind: "image", url: sized("736x", 2) },
      ],
    });
  });

  test("a carousel's picture that is the pin's own isn't taken twice", () => {
    const items = itemsOf({
      id: "8",
      type: "pin",
      image_signature: hash(2),
      images: { orig: { url: sized("originals", 2) } },
      carousel_data: {
        cover_index: 0,
        carousel_slots: [{ images: slotImages(1) }, { images: slotImages(2) }],
      },
    });
    expect(items.map((i) => i.externalId)).toEqual(["8"]);
  });

  test("an idea pin: its video, then its other pages", () => {
    const items = itemsOf({
      id: "9",
      type: "pin",
      image_signature: hash(90),
      images: { orig: { url: sized("originals", 90) } },
      videos: null,
      story_pin_data: {
        pages: [
          {
            blocks: [
              {
                video: {
                  video_list: {
                    V_EXP7: {
                      url: `https://v1.pinimg.com/videos/mc/720p/aa/aa/aa/${hash(5)}.mp4`,
                      width: 720,
                    },
                  },
                },
              },
            ],
          },
          {
            blocks: [
              {
                image: {
                  images: {
                    originals: { url: sized("originals", 6), width: 1080 },
                    "736x": { url: sized("736x", 6), width: 736 },
                  },
                },
              },
            ],
          },
          { blocks: [] },
          {
            blocks: [
              {
                video: {
                  video_list: {
                    V_HLSV3_MOBILE: {
                      url: `https://v1.pinimg.com/videos/mc/hls/aa/aa/aa/${hash(7)}.m3u8`,
                      thumbnail: `https://i.pinimg.com/videos/thumbnails/originals/aa/aa/aa/${hash(7)}.0000000.jpg`,
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });
    expect(items.map((i) => [i.externalId, i.partOf, i.mediaKey])).toEqual([
      ["9", undefined, hash(90)],
      ["9_2", "9", hash(6)],
      ["9_4", "9", hash(7)],
    ]);
    expect(items[0].media[0]).toEqual({
      kind: "video",
      url: `https://v1.pinimg.com/videos/mc/720p/aa/aa/aa/${hash(5)}.mp4`,
    });
    expect(items[1].media).toEqual([
      { kind: "image", url: sized("originals", 6) },
      { kind: "image", url: sized("736x", 6) },
    ]);
    // A playlist can't be stored: its first frame is what there is.
    expect(items[2].media).toEqual([
      {
        kind: "image",
        url: `https://i.pinimg.com/videos/thumbnails/originals/aa/aa/aa/${hash(7)}.0000000.jpg`,
      },
    ]);
  });

  test("a one-page idea pin is just the pin", () => {
    const items = itemsOf({
      id: "10",
      type: "pin",
      images: cover,
      story_pin_data: { pages: [{ blocks: [{ image: { images: cover } }] }] },
    });
    expect(items.map((i) => i.externalId)).toEqual(["10"]);
  });
});
