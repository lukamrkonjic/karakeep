import { describe, expect, test } from "vitest";

import type { Matcher } from "./types/search";
import { parseSearchQuery } from "./searchQueryParser";
import {
  flattenMatcher,
  matcherToQuery,
  negateMatcher,
} from "./searchQueryPrinter";
import { BookmarkTypes } from "./types/bookmarks";

// Fork: smart lists made of rules store their rules printed as a query.
const leaves: Matcher[] = [
  { type: "tagName", tagName: "work", inverse: false },
  { type: "tagName", tagName: "to read later", inverse: true },
  // Looks like a colour: still only the tag (tag:, not #).
  { type: "tagName", tagName: "c8a27a", inverse: false },
  { type: "tagName", tagName: "-dash", inverse: false },
  { type: "tagName", tagName: "is:odd", inverse: false },
  { type: "tagName", tagName: "(paren)", inverse: false },
  { type: "tagName", tagName: "or", inverse: false },
  { type: "tagName", tagName: "and more", inverse: false },
  { type: "tagName", tagName: "čćžšđ", inverse: false },
  { type: "listName", listName: "Vintage cars", inverse: false },
  { type: "listId", listId: "tz4a98xxat96iws9zmbrgj3a", inverse: true },
  { type: "rssFeedName", feedName: "My feed", inverse: false },
  { type: "url", url: "https://www.pinterest.com/pin/1", inverse: false },
  { type: "url", url: "pinterest.com", inverse: true },
  { type: "title", title: "russian matchbox", inverse: false },
  { type: "shows", description: "a red bag", inverse: false },
  { type: "shows", description: "bag", inverse: true },
  { type: "archived", archived: true },
  { type: "archived", archived: false },
  { type: "favourited", favourited: true },
  { type: "favourited", favourited: false },
  { type: "tagged", tagged: false },
  { type: "inlist", inList: true },
  { type: "brokenLinks", brokenLinks: true },
  { type: "type", typeName: BookmarkTypes.LINK, inverse: false },
  { type: "type", typeName: BookmarkTypes.TEXT, inverse: true },
  { type: "type", typeName: BookmarkTypes.ASSET, inverse: false },
  { type: "kind", kind: "picture", inverse: false },
  { type: "kind", kind: "video", inverse: true },
  { type: "kind", kind: "pdf", inverse: false },
  { type: "kind", kind: "note", inverse: false },
  { type: "source", source: "extension", inverse: true },
  { type: "color", color: "red", inverse: false },
  { type: "color", color: "#286ff0", inverse: true },
  // How much of the picture.
  { type: "color", color: "red", inverse: false, min: 40 },
  { type: "color", color: "blue", inverse: false, max: 20 },
  { type: "color", color: "#286ff0", inverse: true, min: 0, max: 60 },
  {
    type: "dateAfter",
    dateAfter: new Date("2026-01-01T00:00:00.000Z"),
    inverse: false,
  },
  {
    type: "dateBefore",
    dateBefore: new Date("2026-03-04T10:20:30.000Z"),
    inverse: true,
  },
  {
    type: "age",
    relativeDate: { direction: "newer", amount: 7, unit: "day" },
  },
  {
    type: "age",
    relativeDate: { direction: "older", amount: 2, unit: "month" },
  },
];

function roundTrip(matcher: Matcher) {
  const query = matcherToQuery(matcher);
  const parsed = parseSearchQuery(query);
  expect(parsed, query).toMatchObject({ result: "full", text: "" });
  expect(parsed.matcher, query).toEqual(flattenMatcher(matcher));
}

describe("matcherToQuery", () => {
  test("every kind of condition reads back as itself", () => {
    for (const leaf of leaves) {
      roundTrip(leaf);
    }
  });

  test("ands and ors, nested", () => {
    const [a, b, c, d, e] = leaves;
    roundTrip({ type: "and", matchers: [a, b, c] });
    roundTrip({ type: "or", matchers: [a, b] });
    roundTrip({
      type: "and",
      matchers: [a, { type: "or", matchers: [b, c] }, d],
    });
    roundTrip({
      type: "or",
      matchers: [{ type: "and", matchers: [a, b] }, c],
    });
    roundTrip({
      type: "and",
      matchers: [
        { type: "or", matchers: [a, { type: "and", matchers: [b, c] }] },
        { type: "or", matchers: [d, e] },
      ],
    });
    expect(
      matcherToQuery({
        type: "and",
        matchers: [
          { type: "color", color: "red", inverse: false },
          {
            type: "or",
            matchers: [
              { type: "favourited", favourited: true },
              { type: "shows", description: "red bag", inverse: false },
            ],
          },
        ],
      }),
    ).toEqual('color:red (is:fav or shows:"red bag")');
  });

  test("quotes can't be said, so they're dropped", () => {
    expect(
      matcherToQuery({ type: "title", title: 'a "b" c', inverse: false }),
    ).toEqual('title:"a b c"');
  });
});

describe("negateMatcher", () => {
  test("twice is the same again", () => {
    for (const leaf of leaves) {
      expect(negateMatcher(negateMatcher(leaf))).toEqual(leaf);
    }
  });

  test("ands and ors swap; age swaps newer and older", () => {
    expect(
      negateMatcher({
        type: "and",
        matchers: [
          { type: "favourited", favourited: true },
          {
            type: "age",
            relativeDate: { direction: "newer", amount: 7, unit: "day" },
          },
        ],
      }),
    ).toEqual({
      type: "or",
      matchers: [
        { type: "favourited", favourited: false },
        {
          type: "age",
          relativeDate: { direction: "older", amount: 7, unit: "day" },
        },
      ],
    });
  });
});
