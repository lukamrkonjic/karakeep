// Builds the bookmarklet from the userscript, so the two can never drift.
//   node tools/make-bookmarklet.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "karakeep-drag-fix.user.js"), "utf-8");

const { code } = await esbuild.transform(source, {
  minify: true,
  target: "es2020",
});

// A bookmarklet is one URL, so the payload has to be encoded. `void 0` keeps
// the click from replacing the page with the expression's result.
const href = "javascript:" + encodeURIComponent(code.trim() + "void 0;");

writeFileSync(join(here, "bookmarklet.txt"), href, "utf-8");

const page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Karakeep drag fix — bookmarklet</title>
    <style>
      :root { color-scheme: light dark; font-family: "Segoe UI", system-ui, sans-serif; }
      body { margin: 0 auto; padding: 32px 24px; max-width: 620px; line-height: 1.6; }
      h1 { font-size: 19px; margin: 0 0 6px; }
      p { font-size: 14px; }
      .drag {
        display: inline-block; margin: 18px 0; padding: 11px 20px;
        border: 1px solid currentColor; border-radius: 9px;
        font-size: 15px; font-weight: 600; text-decoration: none; color: inherit;
        cursor: grab;
      }
      ol { font-size: 14px; padding-left: 20px; }
      li { margin-bottom: 7px; }
      .note { font-size: 13px; opacity: 0.72; }
      code { background: rgba(128,128,128,0.16); padding: 1px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Karakeep drag fix</h1>
    <p>
      Some sites (Pinterest among them) start a drag carrying no data at all,
      so nothing can be dropped out of them. This attaches the image URL to
      those drags. Nothing is installed &mdash; it is just a bookmark.
    </p>

    <a class="drag" href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Karakeep drag fix</a>

    <ol>
      <li>Show the bookmarks toolbar if it is hidden (<code>Ctrl+Shift+B</code>).</li>
      <li>Drag the button above onto it.</li>
      <li>On a page where dragging images does not work, click it once.</li>
      <li>Drag the image as normal.</li>
    </ol>

    <p class="note">
      One click covers the whole page. Pinterest is a single-page app, so
      moving between pins usually keeps it active &mdash; click again if a
      drag comes up empty. For something permanent instead of per-visit, the
      same code is in <code>karakeep-drag-fix.user.js</code> for a userscript
      manager.
    </p>
  </body>
</html>
`;
writeFileSync(join(here, "install-bookmarklet.html"), page, "utf-8");

console.log(`bookmarklet: ${href.length} chars`);
console.log("wrote tools/bookmarklet.txt and tools/install-bookmarklet.html");
