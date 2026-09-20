/*
 * Looks at the actual drag image.
 *
 * Everything else in this repo captures a web page, and the drag image is not
 * in one — the OS composites it above every window, which is why every
 * previous attempt at this bug was reasoning rather than seeing.
 * desktopCapturer grabs the screen itself, so a screenshot taken while the
 * button is still down includes whatever is riding under the cursor.
 *
 *   npx electron test/diagnose-drag-image.cjs <url> [outfile.png]
 *
 * MAGPIE_SETTLE  ms to wait for the page (default 14000; pin pages are slow)
 */
const {
  app,
  BrowserWindow,
  WebContentsView,
  desktopCapturer,
  screen,
} = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

const target = process.argv.find((a) => /^https?:\/\//i.test(a));
/*
 * The output path comes from the environment, not a second argument: give
 * Electron's CLI two positional arguments and it exits silently without ever
 * loading the script, which costs an hour to notice because there is no error.
 */
const out = process.env.MAGPIE_OUT || join(__dirname, "drag.png");
const settle = Number(process.env.MAGPIE_SETTLE ?? 14000);

const FIND = `(() => {
  const vw = innerWidth, vh = innerHeight;
  // elementsFromPoint rather than document.images: it sees through shadow
  // roots and past overlays, and some pins keep their picture out of reach of
  // a plain document-level query.
  const step = 40;
  const seen = new Map();
  for (let y = 80; y < vh - 40; y += step) {
    for (let x = 80; x < vw - 40; x += step) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el.tagName === "IMG" && (el.currentSrc || el.src)) {
          const b = el.getBoundingClientRect();
          if (b.width > 150 && b.height > 150) seen.set(el, b);
          break;
        }
      }
    }
  }
  if (!seen.size) return null;
  let best = null, area = 0;
  for (const [el, b] of seen) {
    const a = b.width * b.height;
    if (a > area) { area = a; best = { el, b }; }
  }
  const b = best.b;
  return {
    x: Math.round(Math.min(Math.max(b.left + b.width / 2, 20), vw - 20)),
    y: Math.round(Math.min(Math.max(b.top + b.height / 2, 20), vh - 20)),
    size: Math.round(b.width) + "x" + Math.round(b.height),
    draggable: best.el.getAttribute("draggable"),
    userDrag: getComputedStyle(best.el).webkitUserDrag || "(unset)",
    inDocumentImages: [...document.images].includes(best.el),
    inShadow: best.el.getRootNode() !== document,
    src: (best.el.currentSrc || best.el.src).slice(-34),
  };
})()`;

process.on("unhandledRejection", (e) => {
  console.log("UNHANDLED:", e && e.message ? e.message : e);
});

app.whenReady().then(async () => {
  console.log("target:", target, "| out:", out, "| settle:", settle);
  const win = new BrowserWindow({ width: 1280, height: 900, show: true });
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:magpie",
      preload: join(__dirname, "../dist/preload/capturePreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.contentView.addChildView(view);
  const TOP = 80;
  view.setBounds({ x: 0, y: TOP, width: 1280, height: 900 - TOP - 30 });

  const wc = view.webContents;
  wc.on("dom-ready", () => {
    void wc
      .insertCSS("img, picture, a img { -webkit-user-drag: element !important; }")
      .catch(() => {});
  });

  try {
    await wc.loadURL(target);
  } catch (e) {
    console.log("loadURL rejected:", e && e.message ? e.message : e);
  }
  console.log("landed on:", wc.getURL());
  await new Promise((r) => setTimeout(r, settle));

  const spot = await wc.executeJavaScript(FIND);
  if (!spot) {
    console.log("no image big enough on screen — page may not have rendered");
    app.exit(1);
    return;
  }
  for (const [k, v] of Object.entries(spot)) {
    console.log("  " + String(k).padEnd(18), JSON.stringify(v));
  }

  win.focus();
  await new Promise((r) => setTimeout(r, 400));

  // A real drag, left hanging: the button stays down so the drag image is
  // still on screen when the shot is taken.
  wc.sendInputEvent({
    type: "mouseDown",
    x: spot.x,
    y: spot.y,
    button: "left",
    clickCount: 1,
  });
  for (let i = 1; i <= 18; i++) {
    wc.sendInputEvent({
      type: "mouseMove",
      x: spot.x + i * 9,
      y: spot.y + i * 5,
      button: "left",
    });
    await new Promise((r) => setTimeout(r, 45));
  }
  await new Promise((r) => setTimeout(r, 700));

  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  const shot = sources[0]?.thumbnail;
  if (shot && !shot.isEmpty()) {
    writeFileSync(out, shot.toPNG());
    console.log("\nscreen captured mid-drag ->", out);
  } else {
    console.log("\nscreen capture came back empty");
  }

  wc.sendInputEvent({
    type: "mouseUp",
    x: spot.x + 170,
    y: spot.y + 95,
    button: "left",
  });
  await new Promise((r) => setTimeout(r, 400));
  app.exit(0);
});
