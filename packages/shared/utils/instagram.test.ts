import { describe, expect, test } from "vitest";

import {
  instagramCollectionName,
  instagramCollectionUrl,
  instagramUserIdOf,
  parseInstagramCollectionUrl,
  parseInstagramSession,
} from "./instagram";

describe("Instagram collection links", () => {
  test("a collection", () => {
    const ref = parseInstagramCollectionUrl(
      "https://www.instagram.com/lukamrkonjic/saved/menswear/17904279985007851/",
    );
    expect(ref).toEqual({
      user: "lukamrkonjic",
      slug: "menswear",
      collectionId: "17904279985007851",
    });
    expect(instagramCollectionUrl(ref!)).toBe(
      "https://www.instagram.com/lukamrkonjic/saved/menswear/17904279985007851/",
    );
    expect(instagramCollectionName(ref!)).toBe("menswear");
  });

  test("All posts, however it's linked", () => {
    for (const link of [
      "https://www.instagram.com/lukamrkonjic/saved/all-posts/",
      "https://instagram.com/lukamrkonjic/saved/",
      "https://www.instagram.com/lukamrkonjic/saved/?hl=en",
    ]) {
      const ref = parseInstagramCollectionUrl(link);
      expect(ref?.collectionId).toBeNull();
      expect(instagramCollectionUrl(ref!)).toBe(
        "https://www.instagram.com/lukamrkonjic/saved/all-posts/",
      );
      expect(instagramCollectionName(ref!)).toBe("All posts");
    }
  });

  test("not a collection", () => {
    for (const link of [
      "https://www.instagram.com/lukamrkonjic/",
      "https://www.instagram.com/p/DAbc123/",
      "https://www.instagram.com/lukamrkonjic/saved/menswear/",
      "https://www.instagram.com/lukamrkonjic/saved/menswear/notanid/",
      "https://www.pinterest.com/lukamrk/game-dev/",
      "https://notinstagram.com/lukamrkonjic/saved/all-posts/",
      "not a link",
    ]) {
      expect(parseInstagramCollectionUrl(link)).toBeNull();
    }
  });
});

describe("Instagram sessions", () => {
  const encoded = "123456789%3AAbCdEf123%3A12%3AAYh-signature";

  test("the value as the browser shows it, or decoded", () => {
    for (const pasted of [encoded, decodeURIComponent(encoded)]) {
      const cookies = parseInstagramSession(`  ${pasted}\n`);
      expect(cookies).toEqual({ sessionid: encoded });
      expect(instagramUserIdOf(cookies!)).toBe("123456789");
    }
  });

  test('sessionid=…, Firefox\'s sessionid:"…", or a whole Cookie header', () => {
    expect(parseInstagramSession(`sessionid=${encoded}`)).toEqual({
      sessionid: encoded,
    });
    expect(parseInstagramSession(`sessionid:"${encoded}"`)).toEqual({
      sessionid: encoded,
    });
    expect(
      parseInstagramSession(
        `Cookie: csrftoken=tok123; ds_user_id=123456789; sessionid=${encoded}; rur="x"`,
      ),
    ).toEqual({ sessionid: encoded, csrftoken: "tok123" });
  });

  test("anything else is refused", () => {
    for (const pasted of [
      "",
      "hello",
      "csrftoken=abc",
      "abc:def:1",
      "%E0%A4%A",
    ]) {
      expect(parseInstagramSession(pasted)).toBeNull();
    }
  });
});
