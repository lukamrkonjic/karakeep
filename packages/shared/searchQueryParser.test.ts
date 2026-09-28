import { describe, expect, test } from "vitest";

import { parseSearchQuery } from "./searchQueryParser";
import { BookmarkTypes } from "./types/bookmarks";

describe("Search Query Parser", () => {
  test("simple is queries", () => {
    expect(parseSearchQuery("is:archived")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "archived",
        archived: true,
      },
    });
    expect(parseSearchQuery("-is:archived")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "archived",
        archived: false,
      },
    });
    expect(parseSearchQuery("is:fav")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "favourited",
        favourited: true,
      },
    });
    expect(parseSearchQuery("-is:fav")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "favourited",
        favourited: false,
      },
    });
    expect(parseSearchQuery("is:tagged")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagged",
        tagged: true,
      },
    });
    expect(parseSearchQuery("-is:tagged")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagged",
        tagged: false,
      },
    });
    expect(parseSearchQuery("is:inlist")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "inlist",
        inList: true,
      },
    });
    expect(parseSearchQuery("-is:inlist")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "inlist",
        inList: false,
      },
    });
    expect(parseSearchQuery("is:link")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.LINK,
        inverse: false,
      },
    });
    expect(parseSearchQuery("-is:link")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.LINK,
        inverse: true,
      },
    });
    expect(parseSearchQuery("is:text")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.TEXT,
        inverse: false,
      },
    });
    expect(parseSearchQuery("-is:text")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.TEXT,
        inverse: true,
      },
    });
    expect(parseSearchQuery("is:media")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.ASSET,
        inverse: false,
      },
    });
    expect(parseSearchQuery("-is:media")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.ASSET,
        inverse: true,
      },
    });
    expect(parseSearchQuery("is:broken")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "brokenLinks",
        brokenLinks: true,
      },
    });
    expect(parseSearchQuery("-is:broken")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "brokenLinks",
        brokenLinks: false,
      },
    });
  });

  test("simple string queries", () => {
    expect(parseSearchQuery("url:https://example.com")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "url",
        url: "https://example.com",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-url:https://example.com")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "url",
        url: "https://example.com",
        inverse: true,
      },
    });
    expect(parseSearchQuery('url:"https://example.com"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "url",
        url: "https://example.com",
        inverse: false,
      },
    });
    expect(parseSearchQuery('-url:"https://example.com"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "url",
        url: "https://example.com",
        inverse: true,
      },
    });
    expect(parseSearchQuery("title:example")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "title",
        title: "example",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-title:example")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "title",
        title: "example",
        inverse: true,
      },
    });
    expect(parseSearchQuery('title:"my title"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "title",
        title: "my title",
        inverse: false,
      },
    });
    expect(parseSearchQuery('-title:"my title"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "title",
        title: "my title",
        inverse: true,
      },
    });
    expect(parseSearchQuery("#my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my-tag",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-#my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my-tag",
        inverse: true,
      },
    });
    expect(parseSearchQuery('#"my tag"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my tag",
        inverse: false,
      },
    });
    expect(parseSearchQuery('-#"my tag"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my tag",
        inverse: true,
      },
    });
    // Tags starting with qualifiers should be treated correctly
    expect(parseSearchQuery("#android")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "android",
        inverse: false,
      },
    });
    expect(parseSearchQuery("list:my-list")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "listName",
        listName: "my-list",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-list:my-list")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "listName",
        listName: "my-list",
        inverse: true,
      },
    });
    expect(parseSearchQuery('list:"my list"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "listName",
        listName: "my list",
        inverse: false,
      },
    });
    expect(parseSearchQuery('-list:"my list"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "listName",
        listName: "my list",
        inverse: true,
      },
    });
    expect(parseSearchQuery("feed:my-feed")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "rssFeedName",
        feedName: "my-feed",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-feed:my-feed")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "rssFeedName",
        feedName: "my-feed",
        inverse: true,
      },
    });
    expect(parseSearchQuery('feed:"my feed"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "rssFeedName",
        feedName: "my feed",
        inverse: false,
      },
    });
    expect(parseSearchQuery('-feed:"my feed"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "rssFeedName",
        feedName: "my feed",
        inverse: true,
      },
    });
    expect(parseSearchQuery("source:rss")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "source",
        source: "rss",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-source:rss")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "source",
        source: "rss",
        inverse: true,
      },
    });
    expect(parseSearchQuery("source:web")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "source",
        source: "web",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-source:web")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "source",
        source: "web",
        inverse: true,
      },
    });
  });
  test("! negation alias for -", () => {
    // ! should work exactly like - for negation
    expect(parseSearchQuery("!is:archived")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "archived",
        archived: false,
      },
    });
    expect(parseSearchQuery("!is:fav")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "favourited",
        favourited: false,
      },
    });
    expect(parseSearchQuery("!#my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my-tag",
        inverse: true,
      },
    });
    expect(parseSearchQuery("!tag:my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my-tag",
        inverse: true,
      },
    });
    expect(parseSearchQuery("!url:example.com")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "url",
        url: "example.com",
        inverse: true,
      },
    });
    expect(parseSearchQuery("!list:my-list")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "listName",
        listName: "my-list",
        inverse: true,
      },
    });
    expect(parseSearchQuery("!is:link")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "type",
        typeName: BookmarkTypes.LINK,
        inverse: true,
      },
    });
    // Combined with complex queries
    expect(parseSearchQuery("is:fav !is:archived")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "and",
        matchers: [
          {
            type: "favourited",
            favourited: true,
          },
          {
            type: "archived",
            archived: false,
          },
        ],
      },
    });
  });

  test("tag: qualifier alias for #", () => {
    // tag: should work exactly like #
    expect(parseSearchQuery("tag:my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my-tag",
        inverse: false,
      },
    });
    expect(parseSearchQuery("-tag:my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my-tag",
        inverse: true,
      },
    });
    expect(parseSearchQuery('tag:"my tag"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my tag",
        inverse: false,
      },
    });
    expect(parseSearchQuery('-tag:"my tag"')).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "my tag",
        inverse: true,
      },
    });
    // Tags starting with qualifiers should be treated correctly
    expect(parseSearchQuery("tag:android")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "tagName",
        tagName: "android",
        inverse: false,
      },
    });
  });

  test("date queries", () => {
    expect(parseSearchQuery("after:2023-10-12")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "dateAfter",
        dateAfter: new Date("2023-10-12"),
        inverse: false,
      },
    });
    expect(parseSearchQuery("-after:2023-10-12")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "dateAfter",
        dateAfter: new Date("2023-10-12"),
        inverse: true,
      },
    });
    expect(parseSearchQuery("before:2023-10-12")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "dateBefore",
        dateBefore: new Date("2023-10-12"),
        inverse: false,
      },
    });
    expect(parseSearchQuery("-before:2023-10-12")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "dateBefore",
        dateBefore: new Date("2023-10-12"),
        inverse: true,
      },
    });
  });
  test("age queries", () => {
    expect(parseSearchQuery("age:<3d")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "age",
        relativeDate: {
          direction: "newer",
          amount: 3,
          unit: "day",
        },
      },
    });
    expect(parseSearchQuery("age:>2y")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "age",
        relativeDate: {
          direction: "older",
          amount: 2,
          unit: "year",
        },
      },
    });
  });

  test("complex queries", () => {
    expect(parseSearchQuery("is:fav -is:archived")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "and",
        matchers: [
          {
            type: "favourited",
            favourited: true,
          },
          {
            type: "archived",
            archived: false,
          },
        ],
      },
    });

    expect(parseSearchQuery("(is:fav is:archived) #my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "and",
        matchers: [
          {
            type: "favourited",
            favourited: true,
          },
          {
            type: "archived",
            archived: true,
          },
          {
            type: "tagName",
            tagName: "my-tag",
            inverse: false,
          },
        ],
      },
    });

    expect(parseSearchQuery("(is:fav is:archived) or (#my-tag)")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "or",
        matchers: [
          {
            type: "and",
            matchers: [
              {
                type: "favourited",
                favourited: true,
              },
              {
                type: "archived",
                archived: true,
              },
            ],
          },
          {
            type: "tagName",
            tagName: "my-tag",
            inverse: false,
          },
        ],
      },
    });

    expect(parseSearchQuery("(is:fav or is:archived) and #my-tag")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "and",
        matchers: [
          {
            type: "or",
            matchers: [
              {
                type: "favourited",
                favourited: true,
              },
              {
                type: "archived",
                archived: true,
              },
            ],
          },
          {
            type: "tagName",
            tagName: "my-tag",
            inverse: false,
          },
        ],
      },
    });
  });
  test("pure text", () => {
    expect(parseSearchQuery("hello")).toEqual({
      result: "full",
      text: "hello",
      matcher: undefined,
    });
    expect(parseSearchQuery("hello world")).toEqual({
      result: "full",
      text: "hello world",
      matcher: undefined,
    });
  });

  test("text interlived with matchers", () => {
    expect(
      parseSearchQuery(
        "hello is:fav world is:archived mixed world #my-tag test",
      ),
    ).toEqual({
      result: "full",
      text: "hello world mixed world test",
      matcher: {
        type: "and",
        matchers: [
          {
            type: "favourited",
            favourited: true,
          },
          {
            type: "archived",
            archived: true,
          },
          {
            type: "tagName",
            tagName: "my-tag",
            inverse: false,
          },
        ],
      },
    });
  });

  test("unknown qualifiers are emitted as pure text", () => {
    expect(parseSearchQuery("is:fav is:helloworld")).toEqual({
      result: "full",
      text: "is:helloworld",
      matcher: {
        type: "favourited",
        favourited: true,
      },
    });
  });

  test("partial results", () => {
    expect(parseSearchQuery("(is:archived) or ")).toEqual({
      result: "partial",
      text: "or",
      matcher: {
        type: "archived",
        archived: true,
      },
    });
    expect(parseSearchQuery("is:fav is: ( random")).toEqual({
      result: "partial",
      text: "is: ( random",
      matcher: {
        type: "favourited",
        favourited: true,
      },
    });
  });

  // Fork: pictures by colour.
  test("color: a family, another name for one, or a colour", () => {
    expect(parseSearchQuery("color:red")).toEqual({
      result: "full",
      text: "",
      matcher: { type: "color", color: "red", inverse: false },
    });
    expect(parseSearchQuery("-colour:gray")).toEqual({
      result: "full",
      text: "",
      matcher: { type: "color", color: "grey", inverse: true },
    });
    // Its # isn't a tag's.
    expect(parseSearchQuery("color:#286FF0")).toEqual({
      result: "full",
      text: "",
      matcher: { type: "color", color: "#286ff0", inverse: false },
    });
    expect(parseSearchQuery("sofa color:navy #living")).toEqual({
      result: "full",
      text: "sofa",
      matcher: {
        type: "and",
        matchers: [
          { type: "color", color: "blue", inverse: false },
          { type: "tagName", tagName: "living", inverse: false },
        ],
      },
    });
    // Not a colour: just words.
    expect(parseSearchQuery("color:sofa")).toEqual({
      result: "full",
      text: "color:sofa",
      matcher: undefined,
    });
  });

  test("# and six hex digits: that colour, or a tag that looks like it", () => {
    const tag = { type: "tagName", tagName: "C8A27A", inverse: false };
    const color = { type: "color", color: "#c8a27a", inverse: false };
    expect(parseSearchQuery("#C8A27A")).toEqual({
      result: "full",
      text: "",
      matcher: { type: "or", matchers: [tag, color] },
    });
    expect(parseSearchQuery("-#C8A27A")).toEqual({
      result: "full",
      text: "",
      matcher: {
        type: "and",
        matchers: [
          { ...tag, inverse: true },
          { ...color, inverse: true },
        ],
      },
    });
    expect(parseSearchQuery("armchair #C8A27A")).toEqual({
      result: "full",
      text: "armchair",
      matcher: { type: "or", matchers: [tag, color] },
    });
    // Any other # is a tag, and tag: always is.
    for (const query of ["#bed", "#c8a27", "tag:c8a27a"]) {
      expect(parseSearchQuery(query).matcher).toEqual({
        type: "tagName",
        tagName: query.replace(/^#|^tag:/, ""),
        inverse: false,
      });
    }
  });
});
