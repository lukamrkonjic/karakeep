import { describe, expect, test, vi } from "vitest";

import type { InstagramFetch } from "./instagram";
import {
  checkInstagramSession,
  instagramApi,
  InstagramRequestError,
  InstagramSessionError,
} from "./instagram";

const cookies = { sessionid: "123456789%3AAbC%3A12%3Asig" };

function answer(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): InstagramFetch {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
}

describe("Instagram API", () => {
  test("sends the session the way the page does", async () => {
    const fetch = answer(200, { status: "ok", items: [] });
    await instagramApi("/feed/saved/posts/", cookies, { fetch });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://www.instagram.com/api/v1/feed/saved/posts/");
    expect(init.redirect).toBe("manual");
    expect(init.headers["x-ig-app-id"]).toBe("936619743392459");
    // Without it Instagram sends its web page, not data.
    expect(init.headers["sec-fetch-dest"]).toBe("empty");
    const csrf = init.headers["x-csrftoken"];
    expect(init.headers.cookie).toBe(
      `sessionid=123456789%3AAbC%3A12%3Asig; ds_user_id=123456789; csrftoken=${csrf}`,
    );
  });

  test("a session Instagram doesn't take needs replacing", async () => {
    for (const fetch of [
      answer(302, "", {
        location: "https://www.instagram.com/accounts/login/",
      }),
      answer(401, { message: "login_required", status: "fail" }),
      answer(400, { message: "checkpoint_required", status: "fail" }),
      answer(302, "", { location: "https://www.instagram.com/challenge/" }),
    ]) {
      await expect(instagramApi("/x/", cookies, { fetch })).rejects.toThrow(
        InstagramSessionError,
      );
    }
  });

  test("slow down, or a hiccup, is only for now", async () => {
    for (const fetch of [
      answer(429, "Too many requests"),
      answer(400, {
        message: "Please wait a few minutes before you try again.",
        status: "fail",
      }),
      answer(500, "oops"),
    ]) {
      await expect(instagramApi("/x/", cookies, { fetch })).rejects.toThrow(
        InstagramRequestError,
      );
    }
  });

  test("a web page where data should be is no answer", async () => {
    const fetch = answer(200, "<!DOCTYPE html><title>Instagram</title>");
    await expect(instagramApi("/x/", cookies, { fetch })).rejects.toThrow(
      /didn't answer with data/,
    );
  });

  test("checking a session tells whose it is", async () => {
    const fetch: InstagramFetch = vi.fn(async (url: string) => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(
          url.includes("/users/123456789/info/")
            ? { status: "ok", user: { username: "luka" } }
            : { status: "ok", items: [] },
        ),
    }));
    await expect(checkInstagramSession(cookies, { fetch })).resolves.toEqual({
      instagramUserId: "123456789",
      username: "luka",
    });
  });
});
