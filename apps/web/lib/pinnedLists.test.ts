import { describe, expect, test } from "vitest";

import { withPinned } from "./pinnedLists";

describe("withPinned", () => {
  test("pinned at the end, in the order pinned, each once", () => {
    expect(withPinned(undefined, "a", true)).toEqual(["a"]);
    expect(withPinned(["a"], "b", true)).toEqual(["a", "b"]);
    // Pinned again: once, at the end.
    expect(withPinned(["a", "b"], "a", true)).toEqual(["b", "a"]);
  });

  test("unpinned: gone, the rest in their order", () => {
    expect(withPinned(["a", "b", "c"], "b", false)).toEqual(["a", "c"]);
    expect(withPinned(["a"], "z", false)).toEqual(["a"]);
    expect(withPinned(undefined, "a", false)).toEqual([]);
  });
});
