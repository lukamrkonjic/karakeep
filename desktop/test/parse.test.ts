import { fromHtml, mergeStrings, parseUriList } from "../src/shared/dropParse";
import { buildTree } from "../src/shared/listTree";
import type { KarakeepList } from "../src/shared/types";

/**
 * Runs in a real Electron renderer (see run-tests.cjs) because the parser
 * leans on DOMParser. The fixtures are the flavour combinations Firefox and
 * Chrome actually put on a cross-application drag.
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

/* ---------- text/uri-list ---------- */

check(
  "uri-list drops comments and blanks",
  parseUriList("# a comment\nhttps://ex.com/a.jpg\n\n# another\nhttps://ex.com/b.jpg"),
  ["https://ex.com/a.jpg", "https://ex.com/b.jpg"],
);

check("uri-list handles CRLF", parseUriList("https://ex.com/a.jpg\r\n"), [
  "https://ex.com/a.jpg",
]);

/* ---------- text/html ---------- */

check(
  "html: plain img yields src and alt",
  fromHtml(`<meta charset='utf-8'><img src="https://ex.com/cat.jpg" alt="A cat">`),
  { urls: ["https://ex.com/cat.jpg"], title: "A cat", baseUrl: null },
);

check(
  "html: srcset picks the widest first",
  fromHtml(
    `<img srcset="https://ex.com/s.jpg 320w, https://ex.com/l.jpg 1280w, https://ex.com/m.jpg 640w" src="https://ex.com/s.jpg">`,
  ).urls,
  [
    "https://ex.com/l.jpg",
    "https://ex.com/m.jpg",
    "https://ex.com/s.jpg",
    "https://ex.com/s.jpg",
  ],
);

check(
  "html: relative src resolves against <base>",
  fromHtml(
    `<base href="https://ex.com/gallery/index.html"><img src="../img/cat.png">`,
  ),
  { urls: ["https://ex.com/img/cat.png"], title: null, baseUrl: "https://ex.com/gallery/index.html" },
);

check(
  "html: relative src with no base is skipped, not passed through broken",
  fromHtml(`<img src="/img/cat.png" alt="x">`),
  { urls: [], title: "x", baseUrl: null },
);

check(
  "html: video element yields src then poster",
  fromHtml(
    `<video src="https://ex.com/v.mp4" poster="https://ex.com/p.jpg"></video>`,
  ).urls,
  ["https://ex.com/v.mp4", "https://ex.com/p.jpg"],
);

check(
  "html: anchor text becomes the title when there is no img",
  fromHtml(`<a href="https://ex.com/post">A blog post</a>`),
  { urls: ["https://ex.com/post"], title: "A blog post", baseUrl: null },
);

check(
  "html: empty alt does not shadow the anchor text",
  fromHtml(`<img src="https://ex.com/c.jpg" alt=""><a href="https://ex.com/p">Post</a>`)
    .title,
  "Post",
);

/* ---------- whole-drop merges ---------- */

check(
  "firefox image drag: img url wins, moz title kept",
  mergeStrings({
    html: `<img src="https://cdn.ex.com/full.jpg" alt="Sunset">`,
    uriList: "https://cdn.ex.com/full.jpg",
    mozUrl: "https://cdn.ex.com/full.jpg\nSunset over the bay",
    plain: "https://cdn.ex.com/full.jpg",
  }),
  {
    urls: ["https://cdn.ex.com/full.jpg"],
    title: "Sunset",
    sourcePageUrl: null,
  },
);

check(
  "chrome image drag: the img src leads the candidates",
  mergeStrings({
    html: `<meta charset='utf-8'><img src="https://cdn.ex.com/pic.webp"/>`,
    uriList: "https://cdn.ex.com/pic.webp",
    mozUrl: "",
    plain: "https://cdn.ex.com/pic.webp",
  }).urls,
  ["https://cdn.ex.com/pic.webp"],
);

check(
  "linked image: the media url is tried before the page it links to",
  mergeStrings({
    html: `<a href="https://ex.com/photo-page"><img src="https://cdn.ex.com/thumb.jpg"></a>`,
    uriList: "https://ex.com/photo-page",
    mozUrl: "",
    plain: "",
  }).urls,
  ["https://cdn.ex.com/thumb.jpg", "https://ex.com/photo-page"],
);

check(
  "base href is surfaced as the source page (used as the Referer)",
  mergeStrings({
    html: `<base href="https://ex.com/album/"><img src="pic.jpg">`,
    uriList: "",
    mozUrl: "",
    plain: "",
  }).sourcePageUrl,
  "https://ex.com/album/",
);

check(
  "plain text that is not a url becomes the title, not a candidate url",
  mergeStrings({
    html: "",
    uriList: "",
    mozUrl: "",
    plain: "just some selected words",
  }),
  { urls: [], title: "just some selected words", sourcePageUrl: null },
);

check(
  "data: urls survive as candidates",
  mergeStrings({
    html: `<img src="data:image/png;base64,iVBORw0KGgo=">`,
    uriList: "",
    mozUrl: "",
    plain: "",
  }).urls,
  ["data:image/png;base64,iVBORw0KGgo="],
);

check(
  "duplicate urls across flavours collapse to one",
  mergeStrings({
    html: `<img src="https://ex.com/a.jpg">`,
    uriList: "https://ex.com/a.jpg",
    mozUrl: "https://ex.com/a.jpg\ntitle",
    plain: "https://ex.com/a.jpg",
  }).urls,
  ["https://ex.com/a.jpg"],
);

check(
  "an empty drop yields nothing rather than throwing",
  mergeStrings({ html: "", uriList: "", mozUrl: "", plain: "" }),
  { urls: [], title: null, sourcePageUrl: null },
);


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
