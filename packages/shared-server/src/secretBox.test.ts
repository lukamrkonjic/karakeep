import { describe, expect, test } from "vitest";

import { openSecret, sealSecret } from "./secretBox";

describe("secret box", () => {
  test("opens what it sealed, and nothing else", () => {
    const sealed = sealSecret("sessionid=123%3Aabc", "instagram", "s3cret");
    expect(sealed).not.toContain("sessionid");
    expect(openSecret(sealed, "instagram", "s3cret")).toBe(
      "sessionid=123%3Aabc",
    );
    // Another server secret, another purpose, or a changed byte: no.
    expect(openSecret(sealed, "instagram", "other")).toBeNull();
    expect(openSecret(sealed, "pinterest", "s3cret")).toBeNull();
    const [v, iv, data, tag] = sealed.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(
      openSecret(
        [v, iv, flipped.toString("base64"), tag].join(":"),
        "instagram",
        "s3cret",
      ),
    ).toBeNull();
    expect(openSecret("garbage", "instagram", "s3cret")).toBeNull();
  });

  test("the same secret seals differently every time", () => {
    expect(sealSecret("x", "instagram", "s")).not.toBe(
      sealSecret("x", "instagram", "s"),
    );
  });
});
