import { describe, expect, test } from "vitest";

import { colourLeftOutFor } from "./colourLeftOut";
import { parseSearchQuery } from "./searchQueryParser";

// Fork: which smart lists the lists left out of colours apply to.
const leftOutFor = (query: string, leftOut: string[]) => {
  const { matcher } = parseSearchQuery(query);
  if (!matcher) {
    throw new Error("no matcher: " + query);
  }
  return colourLeftOutFor(matcher, leftOut);
};

describe("Lists left out of colours", () => {
  test("a smart list that asks for a colour leaves them out", () => {
    expect(leftOutFor("color:red", ["games"])).toEqual(["games"]);
    expect(leftOutFor("color:#286ff0>=40% is:fav", ["games"])).toEqual([
      "games",
    ]);
    expect(leftOutFor("color:red or tag:sky", ["games"])).toEqual(["games"]);
  });

  test("one that doesn't, or turns the colour round, keeps them", () => {
    expect(leftOutFor("is:fav", ["games"])).toEqual([]);
    expect(leftOutFor("-color:red", ["games"])).toEqual([]);
  });

  test("a list its own rules name stays in", () => {
    expect(leftOutFor("color:red listid:games", ["games", "art"])).toEqual([
      "art",
    ]);
    expect(leftOutFor("color:red -listid:art", ["games", "art"])).toEqual([
      "games",
    ]);
  });
});
