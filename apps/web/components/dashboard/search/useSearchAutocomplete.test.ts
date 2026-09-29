import { describe, expect, test } from "vitest";

import { mentionAt } from "./useSearchAutocomplete";

describe("mentionAt", () => {
  test("a list named after @, spaces and all", () => {
    expect(mentionAt("@Din", 4)).toEqual({ start: 0, term: "Din" });
    expect(mentionAt("chair @interior de", 18)).toEqual({
      start: 6,
      term: "interior de",
    });
    expect(mentionAt("(@food", 6)).toEqual({ start: 1, term: "food" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, term: "" });
  });

  test("only up to the cursor, and not an @ inside a word", () => {
    expect(mentionAt("@food chair", 5)).toEqual({ start: 0, term: "food" });
    expect(mentionAt("mail@example", 12)).toBeNull();
    expect(mentionAt("red chair", 9)).toBeNull();
  });
});
