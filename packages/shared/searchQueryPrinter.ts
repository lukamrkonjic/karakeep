import type { Matcher } from "./types/search";

/**
 * Fork: matchers back into the search language — what a smart list built
 * from rules (smartListRules.ts) stores as its query, so it stays an
 * ordinary smart list that every client and the API understand.
 * parseSearchQuery(matcherToQuery(m)) gives m back, with nested ands and ors
 * flattened as the parser flattens them (searchQueryPrinter.test.ts).
 */

/**
 * A value as the language takes it: bare when that can't be misread (a
 * word, a number, a slug), else quoted. The language can't escape a quote,
 * so quotes are dropped.
 */
function word(value: string): string {
  const clean = value.replace(/"/g, "").trim();
  return /^[\p{L}\p{N}][\p{L}\p{N}_.\-/@+&%~=]*$/u.test(clean)
    ? clean
    : `"${clean}"`;
}

/** A date as after:/before: take it: the day alone when it's midnight UTC. */
function day(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

const AGE_UNITS = { day: "d", week: "w", month: "m", year: "y" } as const;
const TYPE_NAMES = { link: "link", text: "text", asset: "media" } as const;

export function matcherToQuery(matcher: Matcher): string {
  const not = (inverse: boolean) => (inverse ? "-" : "");
  switch (matcher.type) {
    case "and":
      return matcher.matchers
        .map((m) =>
          m.type === "or" ? `(${matcherToQuery(m)})` : matcherToQuery(m),
        )
        .join(" ");
    case "or":
      return matcher.matchers
        .map((m) =>
          m.type === "and" ? `(${matcherToQuery(m)})` : matcherToQuery(m),
        )
        .join(" or ");
    case "tagName":
      return `${not(matcher.inverse)}tag:${word(matcher.tagName)}`;
    case "listName":
      return `${not(matcher.inverse)}list:${word(matcher.listName)}`;
    case "listId":
      return `${not(matcher.inverse)}listid:${word(matcher.listId)}`;
    case "rssFeedName":
      return `${not(matcher.inverse)}feed:${word(matcher.feedName)}`;
    case "url":
      return `${not(matcher.inverse)}url:${word(matcher.url)}`;
    case "title":
      return `${not(matcher.inverse)}title:${word(matcher.title)}`;
    case "shows":
      return `${not(matcher.inverse)}shows:${word(matcher.description)}`;
    case "archived":
      return `${not(!matcher.archived)}is:archived`;
    case "favourited":
      return `${not(!matcher.favourited)}is:fav`;
    case "tagged":
      return `${not(!matcher.tagged)}is:tagged`;
    case "inlist":
      return `${not(!matcher.inList)}is:inlist`;
    case "brokenLinks":
      return `${not(!matcher.brokenLinks)}is:broken`;
    case "type":
      return `${not(matcher.inverse)}is:${TYPE_NAMES[matcher.typeName]}`;
    case "kind":
      return `${not(matcher.inverse)}is:${matcher.kind}`;
    case "source":
      return `${not(matcher.inverse)}source:${matcher.source}`;
    // A family (red) or a colour (#286ff0, the language's own color:#).
    case "color":
      return `${not(matcher.inverse)}color:${matcher.color}`;
    case "dateAfter":
      return `${not(matcher.inverse)}after:${day(matcher.dateAfter)}`;
    case "dateBefore":
      return `${not(matcher.inverse)}before:${day(matcher.dateBefore)}`;
    case "age": {
      const { direction, amount, unit } = matcher.relativeDate;
      return `age:${direction === "newer" ? "<" : ">"}${amount}${AGE_UNITS[unit]}`;
    }
    default: {
      const _exhaustiveCheck: never = matcher;
      throw new Error("Unknown matcher type");
    }
  }
}

/** Ands in ands and ors in ors merged, as parseSearchQuery gives them. */
export function flattenMatcher(matcher: Matcher): Matcher {
  if (matcher.type !== "and" && matcher.type !== "or") {
    return matcher;
  }
  if (matcher.matchers.length === 1) {
    return flattenMatcher(matcher.matchers[0]);
  }
  const matchers: Matcher[] = [];
  for (const child of matcher.matchers.map(flattenMatcher)) {
    if (child.type === matcher.type) {
      matchers.push(...child.matchers);
    } else {
      matchers.push(child);
    }
  }
  return { type: matcher.type, matchers };
}

/**
 * What doesn't match: every rule of a smart list's "…are false" group is
 * turned round with this. Ands and ors swap (De Morgan); `age` swaps newer
 * and older, which the language can't negate with a minus.
 */
export function negateMatcher(matcher: Matcher): Matcher {
  switch (matcher.type) {
    case "and":
      return { type: "or", matchers: matcher.matchers.map(negateMatcher) };
    case "or":
      return { type: "and", matchers: matcher.matchers.map(negateMatcher) };
    case "archived":
      return { ...matcher, archived: !matcher.archived };
    case "favourited":
      return { ...matcher, favourited: !matcher.favourited };
    case "tagged":
      return { ...matcher, tagged: !matcher.tagged };
    case "inlist":
      return { ...matcher, inList: !matcher.inList };
    case "brokenLinks":
      return { ...matcher, brokenLinks: !matcher.brokenLinks };
    case "age":
      return {
        ...matcher,
        relativeDate: {
          ...matcher.relativeDate,
          direction:
            matcher.relativeDate.direction === "newer" ? "older" : "newer",
        },
      };
    case "tagName":
    case "listName":
    case "listId":
    case "rssFeedName":
    case "url":
    case "title":
    case "shows":
    case "type":
    case "kind":
    case "source":
    case "color":
    case "dateAfter":
    case "dateBefore":
      return { ...matcher, inverse: !matcher.inverse };
    default: {
      const _exhaustiveCheck: never = matcher;
      throw new Error("Unknown matcher type");
    }
  }
}
