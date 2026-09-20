/*
 * Pins the one rule about the drag image.
 *
 * Chromium snapshots the element handed to setDragImage only if that element
 * actually painted. An earlier version parked it off-screen at -10000px —
 * the recipe half the internet suggests — and the snapshot came back empty,
 * which is worse than doing nothing: it replaces a working default with a
 * blank picture. The failure is invisible in every ordinary test, because the
 * DOM looks perfect and the drag image lives outside the page.
 *
 * So this asserts the two things that make it paint: the ghost is inside the
 * viewport, and raising it above the page actually changes rendered pixels.
 * The second is the real proof — an element that cannot paint cannot change
 * them.
 */
const { app, BrowserWindow, WebContentsView } = require("electron");
const { createServer } = require("node:http");
const { join } = require("node:path");

/** 2x2 solid magenta PNG, so it is unmistakable against a white page. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8Dwn4GBgYGJgQwAADHwAf2gJKgAAAAASUVORK5CYII=",
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
  const site = createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body style="margin:0;background:#fff">
      <img id="shot" src="/pic.png" width="400" height="300"
           style="image-rendering:pixelated;position:absolute;left:200px;top:150px">
    </body></html>`);
  });
  const port = await listen(site);

  const win = new BrowserWindow({ width: 900, height: 700, show: true });
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
  await wc.loadURL(`http://127.0.0.1:${port}/`);
  await new Promise((r) => setTimeout(r, 600));

  // A real press on the image is what builds the ghost.
  wc.sendInputEvent({
    type: "mouseDown",
    x: 400,
    y: 300,
    button: "left",
    clickCount: 1,
  });
  await new Promise((r) => setTimeout(r, 400));

  const ghost = await wc.executeJavaScript(`(() => {
    const g = document.querySelector("img[data-magpie-ghost]");
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return {
      left: Math.round(r.left), top: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      decoded: g.naturalWidth > 0,
    };
  })()`);

  check("a ghost is built on mousedown", ghost !== null);
  if (ghost) {
    check("it has real size", ghost.w > 0 && ghost.h > 0, JSON.stringify(ghost));
    check("it is decoded", ghost.decoded === true);
    // The regression that started all this: off-screen means never painted.
    check(
      "it sits INSIDE the viewport, not parked off-screen",
      ghost.left >= 0 &&
        ghost.top >= 0 &&
        ghost.left < 900 &&
        ghost.top < 700,
      `at ${ghost.left},${ghost.top} — off-screen elements are never painted, so the drag image would be blank`,
    );
  }

  // The proof: hidden by stacking, it must not show; raised, it must. An
  // element that cannot paint could not do the second.
  const hidden = (await wc.capturePage()).toPNG();
  if (process.env.MAGPIE_OUT) {
    require("node:fs").writeFileSync(process.env.MAGPIE_OUT, hidden);
    console.log("hidden-state capture ->", process.env.MAGPIE_OUT);
  }
  await wc.executeJavaScript(
    `document.querySelector("img[data-magpie-ghost]").style.zIndex = "2147483647"`,
  );
  await new Promise((r) => setTimeout(r, 250));
  const raised = (await wc.capturePage()).toPNG();
  if (process.env.MAGPIE_OUT) {
    require("node:fs").writeFileSync(process.env.MAGPIE_OUT.replace(".png", "-raised.png"), raised);
  }
  check(
    "raising it changes what is rendered, so it paints",
    !hidden.equals(raised),
    "the page looked identical with the ghost stacked in front, so it never painted at all",
  );

  // A press that never became a drag must not leave the clone in the page.
  await wc.executeJavaScript(
    `document.querySelector("img[data-magpie-ghost]").style.zIndex = "-1"`,
  );
  wc.sendInputEvent({ type: "mouseUp", x: 400, y: 300, button: "left" });
  await new Promise((r) => setTimeout(r, 200));
  check(
    "a click that is not a drag cleans the ghost up",
    (await wc.executeJavaScript(
      `!document.querySelector("img[data-magpie-ghost]")`,
    )) === true,
    "the clone outlived the press, and being fixed it drifts into view on scroll",
  );

  for (const f of failures) {
    console.error(`  FAIL  ${f.name}\n        ${f.detail}`);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  site.close();
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error(e);
    app.exit(1);
  }),
);
