/*
 * Proves the page capture end to end, inside a real Electron, with no
 * Karakeep server involved.
 *
 * The point of the test is the cross-origin image. It is served from a second
 * port with no CORS headers at all, so a fetch made by the page itself could
 * never read it. If it still comes back inlined as a data: URI, then the
 * capture ran in its isolated world and reached the main process's
 * credentialed fetch — which is the one thing this browser exists to do and
 * the one thing an ordinary in-page script cannot.
 */
const { app, BrowserWindow, WebContentsView } = require("electron");
const { createServer } = require("node:http");
const { join } = require("node:path");

const { capturePage, registerCaptureBridge } = require("../dist/main/archive.cjs");

/** 1x1 red PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const failures = [];
let passed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push({ name, detail: detail ?? "" });
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function main() {
  // The foreign origin. No Access-Control-Allow-Origin, deliberately.
  const assets = createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    } else {
      res.writeHead(404).end();
    }
  });
  const assetPort = await listen(assets);

  const site = createServer((req, res) => {
    if (req.url === "/style.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end("h1 { color: rgb(17, 34, 51); }");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html>
<html><head><title>Magpie fixture</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
  <h1>Kept by a magpie</h1>
  <img id="foreign" src="http://127.0.0.1:${assetPort}/pic.png" width="1" height="1">
  <script>document.body.dataset.ranScript = "yes";</script>
</body></html>`);
  });
  const sitePort = await listen(site);

  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, "../dist/preload/capturePreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });

  const wc = view.webContents;
  await wc.loadURL(`http://127.0.0.1:${sitePort}/`);

  let html = "";
  let error = null;
  try {
    const shot = await capturePage(wc);
    if (process.env.MAGPIE_DUMP) {
      require("node:fs").writeFileSync(process.env.MAGPIE_DUMP, shot.html);
    }
    html = shot.html;
    check("title comes back", shot.title === "Magpie fixture", shot.title);
  } catch (e) {
    error = e;
  }

  check("capture succeeded", error === null, error && error.message);
  check("page text is kept", html.includes("Kept by a magpie"));
  // SingleFile minifies what it inlines, so compare with the whitespace gone.
  const squashed = html.replace(/\s+/g, "");
  check(
    "stylesheet is inlined",
    squashed.includes("rgb(17,34,51)") || squashed.includes("#112233"),
    "no sign of the stylesheet rule in the archive",
  );
  check(
    "cross-origin image is inlined through the bridge",
    html.includes("data:image/png;base64"),
    "the foreign image did not make it in, so the privileged fetch never ran",
  );
  check(
    "scripts are stripped",
    !html.includes("document.body.dataset.ranScript"),
    "a script survived into the archive",
  );

  const inPage = await wc.executeJavaScript(
    "typeof window.__magpie === 'undefined'",
  );
  check(
    "the page's own world cannot see the bridge",
    inPage === true,
    "__magpie was reachable from the page, which would hand every site a credentialed fetch",
  );

  check(
    "what the script did to the DOM survives",
    html.includes("data-ran-script"),
    "the live DOM was not what got serialised",
  );

  for (const f of failures) {
    console.error(`  FAIL  ${f.name}\n        ${f.detail}`);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);

  assets.close();
  site.close();
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(() => {
  registerCaptureBridge();
  main().catch((e) => {
    console.error(e);
    app.exit(1);
  });
});
