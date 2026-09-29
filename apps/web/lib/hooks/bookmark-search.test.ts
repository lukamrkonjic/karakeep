import { describe, expect, test } from "vitest";

import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";
import { smartRulesFromQuery } from "@karakeep/shared/smartListRules";

import { queryWithinLists } from "./bookmark-search";

describe("queryWithinLists", () => {
  test("a query within lists, its own or inside them", () => {
    expect(queryWithinLists("is:fav", [])).toBe("is:fav");
    expect(queryWithinLists("is:fav", ["a"])).toBe("listid:a (is:fav)");
    expect(
      parseSearchQuery(queryWithinLists("is:fav or is:archived", ["a", "b"])),
    ).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "and",
        matchers: [
          {
            type: "or",
            matchers: [
              { type: "listId", listId: "a", inverse: false },
              { type: "listId", listId: "b", inverse: false },
            ],
          },
          {
            type: "or",
            matchers: [
              { type: "favourited", favourited: true },
              { type: "archived", archived: true },
            ],
          },
        ],
      },
    });
  });

  test("saved as a smart list: the lists a rule of their own", () => {
    expect(
      smartRulesFromQuery(queryWithinLists("is:fav", ["a", "b"])).groups,
    ).toEqual([
      {
        match: "all",
        negate: false,
        rules: [
          { field: "lists", op: "contains", value: "a,b" },
          { field: "favourite", op: "is", value: "yes" },
        ],
      },
    ]);
  });
});
