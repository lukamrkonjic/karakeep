/*
 * Does the draggable flip survive?
 *
 * The preload sets draggable="true" on the image under the cursor at
 * mousedown, because Chromium refuses to begin a drag on an image marked
 * draggable="false". If the page re-renders that element between the
 * mousedown and the drag actually starting, the attribute goes back and the
 * drag never happens — which looks exactly like "no preview".
 *
 * This presses the button for real and then watches the attribute.
 *
 *   MAGPIE_SETTLE=15000 electron test/diagnose-draggable.cjs <url>
 */
const { app, BrowserWindow, WebContentsView } = require("electron");
const { join } = require("node:path");

app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

const target = process.argv.find((a) => /^https?:\/\//i.test(a));
const settle = Number(process.env.MAGPIE_SETTLE ?? 14000);

const FIND = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const seen = new Map();
  for (let y = 80; y < vh - 40; y += 40) {
    for (let x = 80; x < vw - 40; x += 40) {
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
  window.__probeImg = best.el;
  const b = best.b;
  return {
    x: Math.round(Math.min(Math.max(b.left + b.width / 2, 20), vw - 20)),
    y: Math.round(Math.min(Math.max(b.top + b.height / 2, 20), vh - 20)),
    size: Math.round(b.width) + "x" + Math.round(b.height),
  };
})()`;

const READ = `(() => {
  const el = window.__probeImg;
  if (!el) return { gone: true };
  return {
    draggable: el.getAttribute("draggable"),
    userDrag: getComputedStyle(el).webkitUserDrag || "(unset)",
    stillInDom: el.isConnected,
  };
})()`;

app.whenReady().then(async () => {
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
  view.setBounds({ x: 0, y: 80, width: 1280, height: 790 });

  const wc = view.webContents;
  wc.on("dom-ready", () => {
    void wc
      .insertCSS("img, picture, a img { -webkit-user-drag: element !important; }")
      .catch(() => {});
  });

  await wc.loadURL(target);
  await new Promise((r) => setTimeout(r, settle));

  const spot = await wc.executeJavaScript(FIND);
  if (!spot) {
    console.log("no image big enough on screen");
    app.exit(1);
    return;
  }
  console.log("image", spot.size, "at", spot.x + "," + spot.y);
  console.log("before mousedown:", JSON.stringify(await wc.executeJavaScript(READ)));

  wc.sendInputEvent({
    type: "mouseDown",
    x: spot.x,
    y: spot.y,
    button: "left",
    clickCount: 1,
  });

  for (const delay of [0, 60, 150, 400, 900]) {
    await new Promise((r) => setTimeout(r, delay === 0 ? 20 : delay));
    console.log(
      ("after +" + delay + "ms:").padEnd(16),
      JSON.stringify(await wc.executeJavaScript(READ)),
    );
    // Nudge the pointer the way a real drag would, since a re-render is often
    // driven by the press being interpreted as a gesture.
    wc.sendInputEvent({
      type: "mouseMove",
      x: spot.x + 12,
      y: spot.y + 7,
      button: "left",
    });
  }

  wc.sendInputEvent({ type: "mouseUp", x: spot.x + 12, y: spot.y + 7, button: "left" });
  await new Promise((r) => setTimeout(r, 300));
  app.exit(0);
});
