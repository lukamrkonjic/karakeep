import { describe, expect, test } from "vitest";

import type { ZSmartListRules, ZSmartRule } from "./types/smartLists";
import { parseSearchQuery } from "./searchQueryParser";
import {
  compileSmartRules,
  newSmartRule,
  SMART_FIELDS,
  smartRuleMatcher,
  smartRulesFor,
  smartRulesFromQuery,
  suggestSmartListName,
} from "./smartListRules";

// Fork: a smart list's rules (the editor), as the search language and back.
const all = (...rules: ZSmartRule[]): ZSmartListRules => ({
  groups: [{ match: "all", negate: false, rules }],
});

/** One complete rule for every operator of every field. */
const SAMPLE_VALUES: Record<string, string> = {
  text: "red bag",
  tag: "work",
  list: "tz4a98xxat96iws9zmbrgj3a",
  colour: "#286ff0",
  kind: "video",
  yesno: "no",
  date: "2026-01-01",
  period: "3w",
  query: "feed:news",
};
const everyRule: ZSmartRule[] = SMART_FIELDS.flatMap((field) =>
  field.operators.map((op) => ({
    field: field.id,
    op: op.id,
    value: op.value ? SAMPLE_VALUES[op.value] : undefined,
  })),
);

describe("Smart list rules", () => {
  test("every rule is a condition, and reads back as itself", () => {
    for (const rule of everyRule) {
      const { query, incomplete } = compileSmartRules(all(rule));
      expect(incomplete, JSON.stringify(rule)).toEqual([]);
      expect(parseSearchQuery(query!).result).toEqual("full");
      const back = smartRulesFromQuery(query!).groups[0].rules[0];
      if (rule.field === "query") {
        // What no field recognises stays a query.
        expect(back).toEqual({ ...rule, value: "feed:news" });
      } else {
        expect(back, query!).toEqual(rule);
      }
    }
  });

  test("what the groups mean", () => {
    const fav: ZSmartRule = { field: "favourite", op: "is", value: "yes" };
    const red: ZSmartRule = { field: "colour", op: "is", value: "red" };
    const q = (rules: ZSmartListRules) => compileSmartRules(rules).query;
    expect(q(all(fav, red))).toEqual("is:fav color:red");
    expect(
      q({ groups: [{ match: "any", negate: false, rules: [fav, red] }] }),
    ).toEqual("is:fav or color:red");
    // …are false: none of them (all), not every one of them (any).
    expect(
      q({ groups: [{ match: "all", negate: true, rules: [fav, red] }] }),
    ).toEqual("-is:fav -color:red");
    expect(
      q({ groups: [{ match: "any", negate: true, rules: [fav, red] }] }),
    ).toEqual("-is:fav or -color:red");
    // Every group has to hold.
    expect(
      q({
        groups: [
          { match: "any", negate: false, rules: [fav, red] },
          {
            match: "all",
            negate: true,
            rules: [{ field: "type", op: "is", value: "video" }],
          },
        ],
      }),
    ).toEqual("(is:fav or color:red) -is:video");
    // A date can't be negated with a minus: newer becomes older.
    expect(
      q({
        groups: [
          {
            match: "all",
            negate: true,
            rules: [{ field: "added", op: "in_last", value: "7d" }],
          },
        ],
      }),
    ).toEqual("age:>7d");
    // A query rule is turned round as a whole.
    expect(
      q({
        groups: [
          {
            match: "all",
            negate: true,
            rules: [
              { field: "query", op: "matches", value: "is:fav or #work" },
            ],
          },
        ],
      }),
    ).toEqual("-is:fav -tag:work");
  });

  test("a Lists rule of several lists: in any of them, or in none", () => {
    const lists = (op: string, value: string): ZSmartRule => ({
      field: "lists",
      op,
      value,
    });
    const red: ZSmartRule = { field: "colour", op: "is", value: "red" };
    const any = (...rules: ZSmartRule[]): ZSmartListRules => ({
      groups: [{ match: "any", negate: false, rules }],
    });
    const q = (rules: ZSmartListRules) => compileSmartRules(rules).query;
    const cases: [ZSmartListRules, string][] = [
      [all(lists("contains", "l1,l2")), "listid:l1 or listid:l2"],
      [all(lists("not_contains", "l1,l2")), "-listid:l1 -listid:l2"],
      [
        all(lists("contains", "l1,l2"), red),
        "(listid:l1 or listid:l2) color:red",
      ],
      [
        all(red, lists("not_contains", "l1,l2,l3")),
        "color:red -listid:l1 -listid:l2 -listid:l3",
      ],
      [
        any(lists("contains", "l1,l2"), red),
        "listid:l1 or listid:l2 or color:red",
      ],
    ];
    for (const [rules, query] of cases) {
      expect(q(rules)).toEqual(query);
      // The query made elsewhere reads back as the one rule.
      expect(smartRulesFromQuery(query), query).toEqual(rules);
    }
    // "…are false": in none of them.
    expect(
      q({
        groups: [
          {
            match: "all",
            negate: true,
            rules: [lists("contains", "l1,l2")],
          },
        ],
      }),
    ).toEqual("-listid:l1 -listid:l2");
    // Spaces, repeats and gaps don't count; no list at all isn't a rule yet.
    expect(q(all(lists("contains", " l1 , l1,,l2 ")))).toEqual(
      "listid:l1 or listid:l2",
    );
    expect(compileSmartRules(all(lists("contains", " , "))).incomplete).toEqual(
      [{ group: 0, rule: 0 }],
    );
    // In both lists is two rules still: one rule means any of them.
    expect(smartRulesFromQuery("listid:l1 listid:l2")).toEqual(
      all(lists("contains", "l1"), lists("contains", "l2")),
    );
  });

  test("rules that aren't complete are left out, and said", () => {
    const compiled = compileSmartRules({
      groups: [
        {
          match: "all",
          negate: false,
          rules: [
            { field: "name", op: "contains", value: "  " },
            { field: "colour", op: "is", value: "not a colour" },
            { field: "tags", op: "empty" },
            { field: "added", op: "before", value: "yesterday" },
            { field: "query", op: "matches", value: "free words" },
            { field: "nope", op: "is", value: "x" },
          ],
        },
      ],
    });
    expect(compiled.query).toEqual("-is:tagged");
    expect(compiled.incomplete).toEqual(
      [0, 1, 3, 4, 5].map((rule) => ({ group: 0, rule })),
    );
    expect(
      compileSmartRules(all({ field: "name", op: "contains", value: "" })),
    ).toMatchObject({ matcher: null, query: null });
    expect(smartRuleMatcher(newSmartRule())).toBeNull();
  });

  test("a query made elsewhere, as rules", () => {
    // Save as smart list on a colour page.
    expect(smartRulesFromQuery("color:red")).toEqual(
      all({ field: "colour", op: "is", value: "red" }),
    );
    expect(smartRulesFromQuery("(color:red or color:blue) is:fav")).toEqual({
      groups: [
        {
          match: "all",
          negate: false,
          rules: [{ field: "favourite", op: "is", value: "yes" }],
        },
        {
          match: "any",
          negate: false,
          rules: [
            { field: "colour", op: "is", value: "red" },
            { field: "colour", op: "is", value: "blue" },
          ],
        },
      ],
    });
    // A list by name (upstream's list:), an or of ands, a -after: — as
    // queries, which keep meaning exactly what they did.
    expect(
      smartRulesFromQuery('list:"Art" (is:fav is:video or #work)'),
    ).toEqual(
      all(
        { field: "query", op: "matches", value: "list:Art" },
        {
          field: "query",
          op: "matches",
          value: "(is:fav is:video) or tag:work",
        },
      ),
    );
    expect(smartRulesFromQuery("-after:2026-01-01").groups[0].rules).toEqual([
      { field: "query", op: "matches", value: "-after:2026-01-01" },
    ]);
    // Not something a smart list can be: kept as it is.
    expect(smartRulesFromQuery("just words").groups[0].rules).toEqual([
      { field: "query", op: "matches", value: "just words" },
    ]);
  });

  test("saved rules are used while they're still what the list is", () => {
    const rules: ZSmartListRules = {
      groups: [
        {
          match: "all",
          negate: true,
          rules: [
            { field: "favourite", op: "is", value: "yes" },
            { field: "colour", op: "is", value: "red" },
          ],
        },
        {
          match: "all",
          negate: false,
          rules: [{ field: "type", op: "is", value: "picture" }],
        },
      ],
    };
    const { query } = compileSmartRules(rules);
    expect(smartRulesFor(query!, rules)).toBe(rules);
    // The query was changed elsewhere (the API): read from the query.
    expect(smartRulesFor("color:blue", rules)).toEqual(
      all({ field: "colour", op: "is", value: "blue" }),
    );
    // Read back, the rules mean the same.
    expect(compileSmartRules(smartRulesFromQuery(query!)).query).toEqual(query);
  });
});

describe("A smart list's suggested name", () => {
  test("from the first rule that says what's in it", () => {
    const name = (...rules: ZSmartRule[]) =>
      suggestSmartListName(all(...rules), {
        listName: (id) => (id === "l1" ? "Art" : undefined),
      });
    expect(name({ field: "colour", op: "is", value: "red" })).toEqual("Red");
    expect(name({ field: "picture", op: "shows", value: "bag" })).toEqual(
      "Bag",
    );
    expect(name({ field: "type", op: "is", value: "video" })).toEqual("Videos");
    expect(name({ field: "lists", op: "contains", value: "l1" })).toEqual(
      "Art",
    );
    expect(name({ field: "added", op: "in_last", value: "7d" })).toEqual(
      "Last 7 days",
    );
    expect(name({ field: "added", op: "in_last", value: "1w" })).toEqual(
      "Last week",
    );
    // Not what it says isn't there, nor what isn't finished.
    expect(
      name(
        { field: "colour", op: "is_not", value: "red" },
        { field: "name", op: "contains", value: "" },
        { field: "favourite", op: "is", value: "yes" },
      ),
    ).toEqual("Favourites");
    expect(name({ field: "tags", op: "empty" })).toEqual("");
  });

  test("of several lists, from their names", () => {
    const names: Record<string, string> = {
      l1: "Art",
      l2: "Cars",
      l3: "Bikes",
      l4: "Boats",
    };
    const name = (value: string) =>
      suggestSmartListName(all({ field: "lists", op: "contains", value }), {
        listName: (id) => names[id],
      });
    expect(name("l1,l2")).toEqual("Art & Cars");
    expect(name("l1,l2,l3")).toEqual("Art, Cars & Bikes");
    expect(name("l1,l2,l3,l4")).toEqual("Art, Cars & 2 more");
    // A list that's gone isn't named.
    expect(name("gone,l2")).toEqual("Cars");
  });
});
