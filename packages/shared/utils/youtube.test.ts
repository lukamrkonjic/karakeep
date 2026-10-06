import { describe, expect, test } from "vitest";

import { youTubeVideoId, youTubeVideoUrl } from "./youtube";

describe("YouTube video links", () => {
  test("the ways a video gets shared", () => {
    for (const link of [
      "https://youtu.be/4JPnfgAng_4",
      "https://youtu.be/4JPnfgAng_4?si=Zp3x8RkQ1abc&t=42",
      "https://www.youtube.com/watch?v=4JPnfgAng_4",
      "https://www.youtube.com/watch?v=4JPnfgAng_4&list=PL123&index=2",
      "https://youtube.com/watch?feature=share&v=4JPnfgAng_4",
      "https://m.youtube.com/watch?v=4JPnfgAng_4",
      "https://music.youtube.com/watch?v=4JPnfgAng_4",
      "https://www.youtube.com/shorts/4JPnfgAng_4",
      "https://www.youtube.com/live/4JPnfgAng_4?si=abc",
      "https://www.youtube.com/embed/4JPnfgAng_4",
      "http://www.youtube.com/v/4JPnfgAng_4",
      "  https://youtu.be/4JPnfgAng_4  ",
    ]) {
      expect(youTubeVideoId(link), link).toBe("4JPnfgAng_4");
    }
  });

  test("anything that isn't one video", () => {
    for (const link of [
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/@channel",
      "https://www.youtube.com/channel/UC1234567890",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?v=short",
      "https://youtu.be/",
      "https://www.youtube.com/",
      "https://notyoutube.com/watch?v=4JPnfgAng_4",
      "https://youtube.com.evil.example/watch?v=4JPnfgAng_4",
      "https://vimeo.com/123456",
      "ftp://youtu.be/4JPnfgAng_4",
      "not a link",
    ]) {
      expect(youTubeVideoId(link), link).toBeNull();
    }
  });

  test("a video's page", () => {
    expect(youTubeVideoUrl("4JPnfgAng_4")).toBe(
      "https://www.youtube.com/watch?v=4JPnfgAng_4",
    );
  });
});
