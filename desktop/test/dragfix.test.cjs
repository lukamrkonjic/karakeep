// Verifies tools/karakeep-drag-fix.user.js against the markup pattern that
// breaks: a draggable transparent overlay sitting on top of the real <img>,
// with the site's own dragstart handler attaching nothing.
const { app, BrowserWindow } = require("electron");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
let passed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failures.push(
      `  FAIL  ${name}\n        expected ${e}\n        got      ${a}`,
    );
  }
}

const FIXTURE = `
<!doctype html><html><body style="margin:0">
  <!-- The Pinterest shape: an <img> with a transparent draggable overlay on
       top, whose dragstart attaches nothing. -->
  <div id="wrap" style="position:relative;width:400px;height:300px">
    <img id="pic" src="https://cdn.example.com/full/photo.jpg"
         srcset="https://cdn.example.com/small.jpg 400w, https://cdn.example.com/big.jpg 1200w"
         style="width:400px;height:300px">
    <div id="overlay" draggable="true"
         style="position:absolute;inset:0;background:transparent"></div>
  </div>

  <!-- A well-behaved image that already attaches its own data. -->
  <img id="good" draggable="true" src="https://cdn.example.com/good.png"
       style="width:50px;height:50px">

  <!-- Background-image only, no <img> anywhere. -->
  <div id="bg" draggable="true"
       style="width:60px;height:60px;background-image:url('https://cdn.example.com/bg.webp')"></div>

  <script>
    // Stands in for the site's own handler: starts a drag, attaches nothing.
    document.getElementById('overlay')
      .addEventListener('dragstart', (e) => { /* deliberately empty */ });
    document.getElementById('good')
      .addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/uri-list', 'https://cdn.example.com/site-chose-this.png');
      });

    window.__fire = (id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const dt = new DataTransfer();
      const ev = new DragEvent('dragstart', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      });
      el.dispatchEvent(ev);
      return {
        types: Array.from(dt.types),
        uriList: dt.getData('text/uri-list'),
        plain: dt.getData('text/plain'),
      };
    };
  </script>
</body></html>`;

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(FIXTURE));
  await sleep(400);

  const js = (code) => win.webContents.executeJavaScript(code);

  // Baseline: without the fix, the overlay drag is empty — the actual bug.
  const before = await js(`JSON.stringify(window.__fire('overlay'))`);
  check(
    "without the fix, dragging the overlay attaches nothing (the bug)",
    JSON.parse(before).types,
    [],
  );

  // Inject the userscript exactly as a userscript manager would.
  const script = readFileSync(
    join(__dirname, "../tools/karakeep-drag-fix.user.js"),
    "utf-8",
  );
  await js(script + "; true");

  const overlay = JSON.parse(await js(`JSON.stringify(window.__fire('overlay'))`));
  check(
    "with the fix, the overlay drag carries a uri-list",
    overlay.types.includes("text/uri-list"),
    true,
  );
  check(
    "and it is the image underneath, at its widest srcset entry",
    overlay.uriList,
    "https://cdn.example.com/big.jpg",
  );
  check(
    "text/plain is filled in too, for apps that only read that",
    overlay.plain,
    "https://cdn.example.com/big.jpg",
  );

  const good = JSON.parse(await js(`JSON.stringify(window.__fire('good'))`));
  check(
    "a site that set its own uri-list is left completely alone",
    good.uriList,
    "https://cdn.example.com/site-chose-this.png",
  );

  const bg = JSON.parse(await js(`JSON.stringify(window.__fire('bg'))`));
  check(
    "a CSS background-image with no <img> is still found",
    bg.uriList,
    "https://cdn.example.com/bg.webp",
  );

  // The bookmarklet is the same source minified and URL-encoded. Run the
  // generated payload itself, so a minifier change can't silently break it.
  const win2 = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await win2.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(FIXTURE));
  await sleep(400);
  const js2 = (code) => win2.webContents.executeJavaScript(code);

  check(
    "the fixture drags empty in the second window too (baseline)",
    JSON.parse(await js2(`JSON.stringify(window.__fire('overlay'))`)).types,
    [],
  );

  const href = readFileSync(join(__dirname, "../tools/bookmarklet.txt"), "utf-8");
  check("the bookmarklet is a javascript: URL", href.startsWith("javascript:"), true);
  const payload = decodeURIComponent(href.slice("javascript:".length));
  await js2(payload + "; true");

  const viaBookmarklet = JSON.parse(
    await js2(`JSON.stringify(window.__fire('overlay'))`),
  );
  check(
    "the minified bookmarklet attaches the same url as the userscript",
    viaBookmarklet.uriList,
    "https://cdn.example.com/big.jpg",
  );
  win2.destroy();

  for (const f of failures) {
    console.error(f);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  app.exit(failures.length === 0 ? 0 : 1);
});
