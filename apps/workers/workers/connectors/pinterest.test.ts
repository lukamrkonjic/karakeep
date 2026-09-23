import { describe, expect, test, vi } from "vitest";

import type { Pin } from "./pinterest";
import { itemOf } from "./pinterest";

// Reading a pin fetches nothing; the board fetcher's network isn't needed.
vi.mock("network", () => ({ fetchWithProxy: vi.fn() }));

const cover = {
  orig: { url: "https://i.pinimg.com/originals/67/0d/34/cover.jpg" },
};

describe("Pinterest pins", () => {
  test("a picture is its original image", () => {
    const item = itemOf({ id: "1", type: "pin", images: cover });
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
    expect(itemOf(pin)?.media.map((m) => m.url)).toEqual([
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
    expect(itemOf(pin)?.media).toEqual([
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
