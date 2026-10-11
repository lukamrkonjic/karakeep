import type { BookmarkKind, Matcher } from "./types/search";
import type {
  ZSmartListRules,
  ZSmartRule,
  ZSmartRuleGroup,
} from "./types/smartLists";
import { parseSearchQuery } from "./searchQueryParser";
import {
  flattenMatcher,
  matcherToQuery,
  negateMatcher,
} from "./searchQueryPrinter";
import { BookmarkTypes } from "./types/bookmarks";
import {
  formatColourRange,
  isColourFamily,
  parseColourRange,
} from "./utils/colours";

/**
 * Fork: the rules a smart list is built from in its editor (Eagle's smart
 * folder rules): "[field] [operator] [value]", in groups that are "all / any
 * of the following are true / false".
 *
 * Every rule becomes a matcher of the search language, so a smart list made
 * of rules is an ordinary smart list whose query is those rules printed
 * (searchQueryPrinter.ts) — the list pages, counts, API and apps need
 * nothing new. A query goes back into rules (smartRulesFromQuery), what no
 * field recognises as a "Search query" rule.
 *
 * TO ADD A CONDITION: add a field to SMART_FIELDS — its operators, and how a
 * rule becomes a matcher and back. When it needs a new kind of value, add
 * the kind here and its input in the web app's SmartRuleValue.tsx; when it
 * needs something the language can't say yet, add a matcher
 * (types/search.ts), its qualifier (searchQueryParser.ts), how it prints
 * (searchQueryPrinter.ts) and how it's evaluated (trpc lib/search.ts).
 */

/** What a rule's value is; each kind has its own input in the editor. */
export type SmartValueKind =
  /** Words. */
  | "text"
  /** A tag's name. */
  | "tag"
  /** Lists' ids, comma-separated (smartListIds): one list, or several. */
  | "list"
  /**
   * A colour family ("red") or a colour ("#286ff0"), and how much of the
   * picture it takes up: "red>=40%<=80%" (utils/colours.ts ColourRange).
   */
  | "colour"
  /** What a bookmark is (SMART_KINDS). */
  | "kind"
  /** "yes" or "no". */
  | "yesno"
  /** A day, "2026-09-28". */
  | "date"
  /** A span of time, "7d" (d, w, m or y). */
  | "period"
  /** The search language itself. */
  | "query";

export interface SmartOperator {
  id: string;
  label: string;
  /** What it takes; none when the operator says it all ("is empty"). */
  value?: SmartValueKind;
}

export interface SmartRuleParts {
  op: string;
  value?: string;
}

export interface SmartField {
  id: string;
  label: string;
  operators: SmartOperator[];
  /** The value input's placeholder. */
  placeholder?: string;
  /** The rule as a matcher; null while it isn't complete (or can't be). */
  toMatcher: (op: string, value: string) => Matcher | null;
  /** The rule this field makes of a matcher, when it's one of its own. */
  fromMatcher: (matcher: Matcher) => SmartRuleParts | null;
}

/** What a bookmark can be, for the Type field. */
export const SMART_KINDS: { id: BookmarkKind | "link"; label: string }[] = [
  { id: "picture", label: "Picture" },
  { id: "video", label: "Video" },
  { id: "link", label: "Link" },
  { id: "note", label: "Note" },
  { id: "pdf", label: "PDF" },
];

export const PERIOD_UNITS = [
  { id: "d", unit: "day", label: "days" },
  { id: "w", unit: "week", label: "weeks" },
  { id: "m", unit: "month", label: "months" },
  { id: "y", unit: "year", label: "years" },
] as const;

/** "7d" → 7 days; null when it isn't a period. */
export function parsePeriod(value: string) {
  const found = /^(\d{1,4})([dwmy])$/.exec(value.trim());
  const unit = PERIOD_UNITS.find((u) => u.id === found?.[2]);
  const amount = Number(found?.[1]);
  return unit && amount >= 1 ? { amount, unit: unit.unit, id: unit.id } : null;
}

/** "2026-09-28" → that day (midnight UTC, as after:/before: read it). */
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }
  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayOf(date: Date): string | null {
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : null;
}

const words = (value: string) => {
  const trimmed = value.replace(/"/g, "").trim();
  return trimmed || null;
};

/** A "list" value's lists: "id1,id2" → ["id1", "id2"]. */
export function smartListIds(value: string | undefined): string[] {
  const ids = (value ?? "").split(",").map((id) => id.trim());
  return [...new Set(ids.filter(Boolean))];
}

/** Lists as a "list" value. */
export const smartListValue = (ids: string[]) => ids.join(",");

/**
 * The lists a matcher is about, when it's what a Lists rule makes: a list,
 * "in any of these" (an or) or "in none of these" (an and of -listid:).
 */
function listIdsOf(m: Matcher): { ids: string[]; inverse: boolean } | null {
  if (m.type === "listId") {
    return { ids: [m.listId], inverse: m.inverse };
  }
  if (m.type === "and" || m.type === "or") {
    const inverse = m.type === "and";
    const ids = m.matchers.flatMap((c) =>
      c.type === "listId" && c.inverse === inverse ? [c.listId] : [],
    );
    if (ids.length > 0 && ids.length === m.matchers.length) {
      return { ids, inverse };
    }
  }
  return null;
}

/** contains / doesn't contain, for fields that search words. */
const CONTAINS: SmartOperator[] = [
  { id: "contains", label: "contains", value: "text" },
  { id: "not_contains", label: "doesn't contain", value: "text" },
];

/** A field that is only a yes or a no (Favourite, Archived). */
function yesNoField(
  id: string,
  label: string,
  toMatcher: (yes: boolean) => Matcher,
  fromMatcher: (matcher: Matcher) => boolean | null,
): SmartField {
  return {
    id,
    label,
    operators: [{ id: "is", label: "is", value: "yesno" }],
    toMatcher: (_op, value) =>
      value === "yes" || value === "no" ? toMatcher(value === "yes") : null,
    fromMatcher: (matcher) => {
      const yes = fromMatcher(matcher);
      return yes === null ? null : { op: "is", value: yes ? "yes" : "no" };
    },
  };
}

export const SMART_FIELDS: SmartField[] = [
  {
    id: "name",
    label: "Name",
    placeholder: "Words in the name",
    operators: CONTAINS,
    toMatcher: (op, value) => {
      const title = words(value);
      return title
        ? { type: "title", title, inverse: op === "not_contains" }
        : null;
    },
    fromMatcher: (m) =>
      m.type === "title"
        ? { op: m.inverse ? "not_contains" : "contains", value: m.title }
        : null,
  },
  {
    id: "tags",
    label: "Tags",
    placeholder: "A tag",
    operators: [
      { id: "contains", label: "contains", value: "tag" },
      { id: "not_contains", label: "doesn't contain", value: "tag" },
      { id: "not_empty", label: "is not empty" },
      { id: "empty", label: "is empty" },
    ],
    toMatcher: (op, value) => {
      if (op === "empty" || op === "not_empty") {
        return { type: "tagged", tagged: op === "not_empty" };
      }
      const tagName = words(value);
      return tagName
        ? { type: "tagName", tagName, inverse: op === "not_contains" }
        : null;
    },
    fromMatcher: (m) => {
      if (m.type === "tagged") {
        return { op: m.tagged ? "not_empty" : "empty" };
      }
      return m.type === "tagName"
        ? { op: m.inverse ? "not_contains" : "contains", value: m.tagName }
        : null;
    },
  },
  {
    // A list and everything under it, as its row in the sidebar counts it.
    // Several lists: in any of them ("contains"), in none ("doesn't").
    id: "lists",
    label: "Lists",
    operators: [
      { id: "contains", label: "contains", value: "list" },
      { id: "not_contains", label: "doesn't contain", value: "list" },
      { id: "not_empty", label: "is not empty" },
      { id: "empty", label: "is empty" },
    ],
    toMatcher: (op, value) => {
      if (op === "empty" || op === "not_empty") {
        return { type: "inlist", inList: op === "not_empty" };
      }
      const ids = smartListIds(value);
      if (ids.length === 0 || !ids.every((id) => /^[\w-]+$/.test(id))) {
        return null;
      }
      const inverse = op === "not_contains";
      const matchers: Matcher[] = ids.map((listId) => ({
        type: "listId",
        listId,
        inverse,
      }));
      return matchers.length === 1
        ? matchers[0]
        : { type: inverse ? "and" : "or", matchers };
    },
    fromMatcher: (m) => {
      if (m.type === "inlist") {
        return { op: m.inList ? "not_empty" : "empty" };
      }
      const lists = listIdsOf(m);
      return lists
        ? {
            op: lists.inverse ? "not_contains" : "contains",
            value: smartListValue(lists.ids),
          }
        : null;
    },
  },
  {
    id: "colour",
    label: "Colour",
    operators: [
      { id: "is", label: "is", value: "colour" },
      { id: "is_not", label: "is not", value: "colour" },
    ],
    toMatcher: (op, value) => {
      const range = parseColourRange(value);
      return range
        ? {
            type: "color",
            color: range.colour,
            inverse: op === "is_not",
            ...(range.min === undefined ? {} : { min: range.min }),
            ...(range.max === undefined ? {} : { max: range.max }),
          }
        : null;
    },
    fromMatcher: (m) =>
      m.type === "color"
        ? {
            op: m.inverse ? "is_not" : "is",
            value: formatColourRange({
              colour: m.color,
              min: m.min,
              max: m.max,
            }),
          }
        : null,
  },
  {
    // What's in the picture, by the picture model (Settings → Pictures).
    id: "picture",
    label: "Picture",
    placeholder: "a bag, a red car, a beach…",
    operators: [
      { id: "shows", label: "shows", value: "text" },
      { id: "not_shows", label: "doesn't show", value: "text" },
    ],
    toMatcher: (op, value) => {
      const description = words(value);
      return description
        ? { type: "shows", description, inverse: op === "not_shows" }
        : null;
    },
    fromMatcher: (m) =>
      m.type === "shows"
        ? { op: m.inverse ? "not_shows" : "shows", value: m.description }
        : null,
  },
  {
    id: "type",
    label: "Type",
    operators: [
      { id: "is", label: "is", value: "kind" },
      { id: "is_not", label: "is not", value: "kind" },
    ],
    toMatcher: (op, value) => {
      const inverse = op === "is_not";
      if (value === "link") {
        return { type: "type", typeName: BookmarkTypes.LINK, inverse };
      }
      const kind = SMART_KINDS.find((k) => k.id === value && k.id !== "link");
      return kind
        ? { type: "kind", kind: kind.id as BookmarkKind, inverse }
        : null;
    },
    fromMatcher: (m) => {
      if (m.type === "kind") {
        return { op: m.inverse ? "is_not" : "is", value: m.kind };
      }
      return m.type === "type" && m.typeName === BookmarkTypes.LINK
        ? { op: m.inverse ? "is_not" : "is", value: "link" }
        : null;
    },
  },
  yesNoField(
    "favourite",
    "Favourite",
    (yes) => ({ type: "favourited", favourited: yes }),
    (m) => (m.type === "favourited" ? m.favourited : null),
  ),
  {
    id: "added",
    label: "Date added",
    operators: [
      { id: "in_last", label: "is in the last", value: "period" },
      { id: "not_in_last", label: "is not in the last", value: "period" },
      { id: "on_or_after", label: "is on or after", value: "date" },
      { id: "before", label: "is before", value: "date" },
    ],
    toMatcher: (op, value) => {
      if (op === "in_last" || op === "not_in_last") {
        const period = parsePeriod(value);
        return period
          ? {
              type: "age",
              relativeDate: {
                direction: op === "in_last" ? "newer" : "older",
                amount: period.amount,
                unit: period.unit,
              },
            }
          : null;
      }
      const date = parseDay(value);
      if (!date) {
        return null;
      }
      return op === "on_or_after"
        ? { type: "dateAfter", dateAfter: date, inverse: false }
        : { type: "dateBefore", dateBefore: date, inverse: false };
    },
    fromMatcher: (m) => {
      if (m.type === "age") {
        const { direction, amount, unit } = m.relativeDate;
        const id = PERIOD_UNITS.find((u) => u.unit === unit)!.id;
        return {
          op: direction === "newer" ? "in_last" : "not_in_last",
          value: `${amount}${id}`,
        };
      }
      // Only the plain forms: -after: and -before: stay a query.
      if (m.type === "dateAfter" && !m.inverse) {
        const day = dayOf(m.dateAfter);
        return day ? { op: "on_or_after", value: day } : null;
      }
      if (m.type === "dateBefore" && !m.inverse) {
        const day = dayOf(m.dateBefore);
        return day ? { op: "before", value: day } : null;
      }
      return null;
    },
  },
  {
    // Where it was saved from: a link's address, a picture's source page.
    id: "url",
    label: "URL",
    placeholder: "pinterest.com",
    operators: CONTAINS,
    toMatcher: (op, value) => {
      const url = words(value);
      return url ? { type: "url", url, inverse: op === "not_contains" } : null;
    },
    fromMatcher: (m) =>
      m.type === "url"
        ? { op: m.inverse ? "not_contains" : "contains", value: m.url }
        : null,
  },
  yesNoField(
    "archived",
    "Archived",
    (yes) => ({ type: "archived", archived: yes }),
    (m) => (m.type === "archived" ? m.archived : null),
  ),
  {
    // Anything else the search language says (and what no field above
    // recognises, reading a query back).
    id: "query",
    label: "Search query",
    placeholder: "tag:work -is:archived",
    operators: [{ id: "matches", label: "matches", value: "query" }],
    toMatcher: (_op, value) => {
      const parsed = parseSearchQuery(value);
      return parsed.result === "full" && !parsed.text && parsed.matcher
        ? parsed.matcher
        : null;
    },
    fromMatcher: () => null,
  },
];

const FIELDS = new Map(SMART_FIELDS.map((f) => [f.id, f]));

export function smartField(id: string): SmartField | undefined {
  return FIELDS.get(id);
}

export function smartOperator(
  rule: Pick<ZSmartRule, "field" | "op">,
): SmartOperator | undefined {
  return FIELDS.get(rule.field)?.operators.find((o) => o.id === rule.op);
}

/** What a new rule of this field and operator starts with. */
export function defaultSmartValue(kind: SmartValueKind | undefined) {
  switch (kind) {
    case "yesno":
      return "yes";
    case "kind":
      return "picture";
    case "period":
      return "7d";
    case undefined:
      return undefined;
    default:
      return "";
  }
}

/** A new rule: the field's first operator, with its default value. */
export function newSmartRule(fieldId = SMART_FIELDS[0].id): ZSmartRule {
  const field = FIELDS.get(fieldId) ?? SMART_FIELDS[0];
  const op = field.operators[0];
  return { field: field.id, op: op.id, value: defaultSmartValue(op.value) };
}

export function newSmartRuleGroup(): ZSmartRuleGroup {
  return { match: "all", negate: false, rules: [newSmartRule()] };
}

/** A rule as a matcher; null while it isn't complete or can't be. */
export function smartRuleMatcher(rule: ZSmartRule): Matcher | null {
  const field = FIELDS.get(rule.field);
  const op = smartOperator(rule);
  if (!field || !op) {
    return null;
  }
  return field.toMatcher(op.id, rule.value ?? "");
}

export interface CompiledSmartRules {
  /** What the list matches; null while no rule is complete. */
  matcher: Matcher | null;
  /** The matcher as the search language: the list's query. */
  query: string | null;
  /** The rules that aren't complete (or valid) yet, by position. */
  incomplete: { group: number; rule: number }[];
}

/**
 * The rules as the search language. A group of "all" is an and, of "any" an
 * or; "…are false" turns each of its rules round; the groups are and-ed.
 * Rules that aren't complete are left out (and listed).
 */
export function compileSmartRules(rules: ZSmartListRules): CompiledSmartRules {
  const incomplete: CompiledSmartRules["incomplete"] = [];
  const groups: Matcher[] = [];
  rules.groups.forEach((group, g) => {
    const matchers: Matcher[] = [];
    group.rules.forEach((rule, r) => {
      const matcher = smartRuleMatcher(rule);
      if (matcher) {
        matchers.push(group.negate ? negateMatcher(matcher) : matcher);
      } else {
        incomplete.push({ group: g, rule: r });
      }
    });
    if (matchers.length > 0) {
      groups.push({
        type: group.match === "all" ? "and" : "or",
        matchers,
      });
    }
  });
  if (groups.length === 0) {
    return { matcher: null, query: null, incomplete };
  }
  const matcher = flattenMatcher({ type: "and", matchers: groups });
  return { matcher, query: matcherToQuery(matcher), incomplete };
}

/** A matcher as one rule: a field's own, else a "Search query" rule. */
function ruleOf(matcher: Matcher): ZSmartRule {
  for (const field of SMART_FIELDS) {
    const parts = field.fromMatcher(matcher);
    if (parts) {
      return { field: field.id, ...parts };
    }
  }
  return { field: "query", op: "matches", value: matcherToQuery(matcher) };
}

const isLeaf = (m: Matcher) => m.type !== "and" && m.type !== "or";

/** A field reads this and / or as one rule of its own (a Lists rule's). */
const isOneRule = (m: Matcher) =>
  SMART_FIELDS.some((field) => field.fromMatcher(m) !== null);

/**
 * An and's / or's parts, its lists taken together as one Lists rule makes
 * them: "in none of these" in an and, "in any of these" in an or — where the
 * first of them was.
 */
function withListsTogether(
  matcher: Extract<Matcher, { type: "and" | "or" }>,
): Matcher[] {
  const inverse = matcher.type === "and";
  const lists = matcher.matchers.filter(
    (m) => m.type === "listId" && m.inverse === inverse,
  );
  if (lists.length < 2) {
    return matcher.matchers;
  }
  return matcher.matchers.flatMap((m) => {
    if (!lists.includes(m)) {
      return [m];
    }
    return m === lists[0] ? [{ type: matcher.type, matchers: lists }] : [];
  });
}

/**
 * A smart list's query as rules, for one that wasn't made in the rule editor
 * (or was changed since, through the API): the plain conditions together in
 * one "all" group, each "this or that" in an "any" group of its own, and
 * whatever no field recognises as a "Search query" rule.
 */
export function smartRulesFromQuery(query: string): ZSmartListRules {
  const parsed = parseSearchQuery(query);
  if (parsed.result !== "full" || parsed.text || !parsed.matcher) {
    return {
      groups: [
        {
          match: "all",
          negate: false,
          rules: [{ field: "query", op: "matches", value: query.trim() }],
        },
      ],
    };
  }
  const matcher = parsed.matcher;
  if (isLeaf(matcher) || isOneRule(matcher)) {
    return {
      groups: [{ match: "all", negate: false, rules: [ruleOf(matcher)] }],
    };
  }
  if (matcher.type === "or") {
    return {
      groups: [
        {
          match: "any",
          negate: false,
          rules: withListsTogether(matcher).map(ruleOf),
        },
      ],
    };
  }
  if (matcher.type !== "and") {
    return {
      groups: [{ match: "all", negate: false, rules: [ruleOf(matcher)] }],
    };
  }
  const all: ZSmartRule[] = [];
  const anyGroups: ZSmartRuleGroup[] = [];
  for (const child of withListsTogether(matcher)) {
    if (
      child.type === "or" &&
      child.matchers.every(isLeaf) &&
      !isOneRule(child)
    ) {
      anyGroups.push({
        match: "any",
        negate: false,
        rules: withListsTogether(child).map(ruleOf),
      });
    } else {
      all.push(ruleOf(child));
    }
  }
  return {
    groups: [
      ...(all.length > 0
        ? [{ match: "all" as const, negate: false, rules: all }]
        : []),
      ...anyGroups,
    ],
  };
}

/**
 * The rules a stored query is: `stored` when it still prints as the query
 * (the list was last saved from the editor), else read back from the query.
 */
export function smartRulesFor(
  query: string,
  stored: ZSmartListRules | null | undefined,
): ZSmartListRules {
  if (stored && compileSmartRules(stored).query === query.trim()) {
    return stored;
  }
  return smartRulesFromQuery(query);
}

const nameOf = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Art", "Art & Cars", "Art, Cars & Bikes", "Art, Cars & 3 more". */
function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 2).join(", ")} & ${names.length - 2} more`;
}

/** A rule's value in words: "Red", "7 days", “bag”… */
export function describeSmartValue(
  kind: SmartValueKind,
  value: string,
  lookup?: { listName?: (id: string) => string | undefined },
): string {
  switch (kind) {
    case "list":
      return listNames(
        smartListIds(value).map(
          (id) => lookup?.listName?.(id) ?? "a list that's gone",
        ),
      );
    case "colour": {
      const range = parseColourRange(value);
      if (!range) {
        return value;
      }
      const name = isColourFamily(range.colour)
        ? nameOf(range.colour)
        : range.colour;
      const { min, max } = range;
      if (max === undefined || max >= 100) {
        return min === undefined ? name : `${name}, at least ${min}%`;
      }
      return min === undefined
        ? `${name}, at most ${max}%`
        : `${name}, ${min}–${max}%`;
    }
    case "kind":
      return SMART_KINDS.find((k) => k.id === value)?.label ?? value;
    case "yesno":
      return value === "yes" ? "yes" : "no";
    case "period": {
      const period = parsePeriod(value);
      if (!period) {
        return value;
      }
      const unit = PERIOD_UNITS.find((u) => u.id === period.id)!;
      return `${period.amount} ${period.amount === 1 ? unit.unit : unit.label}`;
    }
    case "date":
      return value;
    case "text":
    case "tag":
    case "query":
      return `“${value}”`;
  }
}

const PLURALS: Record<string, string> = {
  picture: "Pictures",
  video: "Videos",
  link: "Links",
  note: "Notes",
  pdf: "PDFs",
};

/**
 * A name for a smart list from its first complete rule that says what's in
 * it ("Red", "Bag", "Videos", "Last 7 days"); "" when none does. The
 * editor's name field shows it until one is typed.
 */
export function suggestSmartListName(
  rules: ZSmartListRules,
  lookup?: { listName?: (id: string) => string | undefined },
): string {
  for (const group of rules.groups) {
    if (group.negate) {
      continue;
    }
    for (const rule of group.rules) {
      if (!smartRuleMatcher(rule)) {
        continue;
      }
      const value = rule.value?.trim() ?? "";
      switch (`${rule.field}:${rule.op}`) {
        case "colour:is": {
          const colour = parseColourRange(value)?.colour ?? value;
          return isColourFamily(colour) ? nameOf(colour) : colour;
        }
        case "picture:shows":
        case "tags:contains":
        case "name:contains":
        case "url:contains":
          return nameOf(value);
        case "lists:contains":
          return listNames(
            smartListIds(value).flatMap((id) => {
              const name = lookup?.listName?.(id);
              return name ? [name] : [];
            }),
          );
        case "type:is":
          return PLURALS[value] ?? "";
        case "favourite:is":
          return value === "yes" ? "Favourites" : "";
        case "archived:is":
          return value === "yes" ? "Archived" : "";
        case "added:in_last": {
          // "Last 7 days", "Last week".
          const period = describeSmartValue("period", value);
          return `Last ${period.replace(/^1 /, "")}`;
        }
      }
    }
  }
  return "";
}
