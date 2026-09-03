import { buildTree } from "../src/shared/listTree";
import type { KarakeepList } from "../src/shared/types";

/**
 * Ordering rules for the list picker: most-recently-used first, with the
 * web app's own order as the fallback.
 */

interface Failure {
  name: string;
  detail: string;
}

const failures: Failure[] = [];
let passed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failures.push({ name, detail: `expected ${e}\n       got      ${a}` });
  }
}

/* ---------- list tree ordering ---------- */

function list(
  id: string,
  over: Partial<KarakeepList> = {},
): KarakeepList {
  return {
    id,
    name: id,
    icon: "",
    parentId: null,
    type: "manual",
    position: 0,
    userRole: "owner",
    ...over,
  };
}

/** Flattens to "id(childId,…)" so ordering is readable in a failure. */
function shape(nodes: ReturnType<typeof buildTree>): string {
  return nodes
    .map((n) => (n.children.length ? `${n.id}(${shape(n.children)})` : n.id))
    .join(",");
}

check(
  "with no history, falls back to the web app's own order (position desc)",
  shape(
    buildTree([
      list("a", { position: 1 }),
      list("c", { position: 3 }),
      list("b", { position: 2 }),
    ]),
  ),
  "c,b,a",
);

check(
  "equal positions break the tie by name, not insertion order",
  shape(buildTree([list("pear"), list("apple"), list("fig")])),
  "apple,fig,pear",
);

check(
  "a recently used list outranks a higher position",
  shape(
    buildTree(
      [list("a", { position: 1 }), list("b", { position: 99 })],
      { a: 1_700_000_000_000 },
    ),
  ),
  "a,b",
);

check(
  "more recent sorts above less recent",
  shape(
    buildTree([list("a"), list("b"), list("c")], {
      a: 1_700_000_000_000,
      b: 1_700_000_009_999,
    }),
  ),
  "b,a,c",
);

check(
  "using a subfolder lifts its parent too, and the child leads its siblings",
  shape(
    buildTree(
      [
        list("old", { position: 99 }),
        list("parent", { position: 1 }),
        list("kid", { parentId: "parent", position: 1 }),
        list("kid2", { parentId: "parent", position: 9 }),
      ],
      { kid: 1_700_000_000_000 },
    ),
  ),
  "parent(kid,kid2),old",
);

check(
  "smart lists are excluded — nothing can be filed into a saved query",
  shape(buildTree([list("manual"), list("smart", { type: "smart" })])),
  "manual",
);

check(
  "viewer-role lists are excluded, editor-role kept",
  shape(
    buildTree([
      list("mine"),
      list("readonly", { userRole: "viewer" }),
      list("shared", { userRole: "editor" }),
    ]),
  ),
  "mine,shared",
);

check(
  "a child whose parent was filtered out surfaces at the root, not dropped",
  shape(
    buildTree([
      list("smartparent", { type: "smart" }),
      list("orphan", { parentId: "smartparent" }),
    ]),
  ),
  "orphan",
);

check(
  "recency for an id the server no longer returns is simply ignored",
  shape(buildTree([list("a"), list("b", { position: 5 })], { gone: Date.now() })),
  "b,a",
);

/* ---------- report ---------- */

const summary = { passed, failed: failures.length, failures };
// The runner picks this up off the window object.
(window as unknown as { __RESULTS__: typeof summary }).__RESULTS__ = summary;
document.title = failures.length === 0 ? "PASS" : "FAIL";
