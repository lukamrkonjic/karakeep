/*
 * Drives a real drag with synthesised input, which a dispatched DragEvent
 * cannot do: only real input makes Chromium decide whether a drag may begin
 * and hand the page a genuine dragstart.
 *
 * Reports whether the preload saw it, what it resolved the image to, and
 * whether the element under the cursor is an <img> or something painted on
 * top of one.
 *
 *   npx electron test/diagnose-board-drag.cjs https://se.pinterest.com/
 */
const { app, BrowserWindow, WebContentsView, ipcMain } = require("electron");
const { join } = require("node:path");

app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

const target =
  process.argv.find((a) => /^https?:\/\//i.test(a)) ?? "https://se.pinterest.com/";
const settle = Number(process.env.MAGPIE_SETTLE ?? 10000);

const seen = [];
ipcMain.on("magpie:drag-start", (_e, payload) => seen.push(payload));
ipcMain.on("magpie:drag-end", () => seen.push({ end: true }));
/*
 * To find out WHICH setDragImage call actually ran — which is how the pin
 * page was caught swallowing the event with stopPropagation, leaving only the
 * capture-phase call — add a `ipcRenderer.send("magpie:ghost-trace", phase)`
 * at the top of applyGhost in the preload and it will be collected here.
 */
const phases = [];
ipcMain.on("magpie:ghost-trace", (_e, phase) => phases.push(phase));

const FIND = `(() => {
  // Must be ON SCREEN: the biggest natural image on a board is usually one
  // that is lazy, hidden or scrolled far away, and dragging where it claims
  // to be lands on the body.
  const vw = innerWidth, vh = innerHeight;
  const imgs = [...document.images].filter((i) => {
    if (!i.currentSrc) return false;
    const b = i.getBoundingClientRect();
    // The CENTRE has to be on screen, not the whole image: a pin closeup is
    // routinely taller than the viewport, and demanding it fit entirely
    // rejects the very image the page is about.
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    return b.width > 120 && b.height > 120 &&
           cx > 8 && cx < vw - 8 && cy > 8 && cy < vh - 8;
  });
  if (!imgs.length) return null;
  const area = (i) => { const b = i.getBoundingClientRect(); return b.width * b.height; };
  const img = imgs.sort((a, b) => area(b) - area(a))[0];
  const r = img.getBoundingClientRect();
  const cx = Math.round(Math.min(Math.max(r.left + r.width / 2, 8), vw - 8));
  const cy = Math.round(Math.min(Math.max(r.top + r.height / 2, 8), vh - 8));
  const top = document.elementFromPoint(cx, cy);
  return {
    x: cx, y: cy,
    src: (img.currentSrc || img.src).slice(0, 70),
    topTag: top ? top.tagName.toLowerCase() : null,
    topIsImg: top === img,
    draggableAttr: img.getAttribute("draggable"),
    userDrag: getComputedStyle(img).webkitUserDrag || "(unset)",
    inAnchor: (() => { let a = top; for (let i=0;a&&i<6;i++){ if(a.tagName==="A") return true; a=a.parentElement; } return false; })(),
    stack: document.elementsFromPoint(cx, cy).slice(0, 4).map((e) => e.tagName.toLowerCase()),
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
  const TOP = 80;
  view.setBounds({ x: 0, y: TOP, width: 1280, height: 900 - TOP - 30 });

  const wc = view.webContents;
  wc.on("dom-ready", () => {
    void wc
      .insertCSS("img, picture, a img { -webkit-user-drag: element !important; }")
      .catch(() => {});
  });

  await wc.loadURL(target);
  await new Promise((r) => setTimeout(r, settle));

  // Patch setDragImage in the PAGE's own world, so this records only what the
  // site calls — our own calls live in an isolated world and cannot be seen
  // from here, which is exactly what makes this a clean read of Pinterest.
  await wc.executeJavaScript(`(() => {
    window.__sdiCalls = [];
    const orig = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (el, x, y) {
      try {
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        window.__sdiCalls.push({
          tag: el && el.tagName ? el.tagName.toLowerCase() : String(el),
          w: r ? Math.round(r.width) : null,
          h: r ? Math.round(r.height) : null,
          x, y,
          src: (el && el.src ? String(el.src) : "").slice(0, 48),
        });
      } catch (e) { window.__sdiCalls.push({ error: String(e) }); }
      return orig.call(this, el, x, y);
    };
    return true;
  })()`);

  const spot = await wc.executeJavaScript(FIND);
  if (!spot) {
    console.log("no image found");
    app.exit(1);
    return;
  }
  for (const [k, v] of Object.entries(spot)) {
    console.log(String(k).padEnd(15), JSON.stringify(v));
  }

  // Coordinates for sendInputEvent are relative to the view, and the probe
  // measured them relative to the page, which is the same origin here.
  const press = (type, x, y) =>
    wc.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });

  console.log("\nsynthesising a real drag...");
  const ghostProbe = `(() => {
       const g = [...document.images].find((i) => i.style.left === "-10000px");
       if (!g) return null;
       const r = g.getBoundingClientRect();
       return {
         w: g.width, h: g.height,
         complete: g.complete,
         decoded: g.naturalWidth > 0,
         laidOut: r.width > 0 && r.height > 0,
       };
     })()`;

  press("mouseDown", spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 250));
  console.log(
    "ghost after mousedown, before movement:",
    JSON.stringify(await wc.executeJavaScript(ghostProbe)),
  );
  for (let i = 1; i <= 14; i++) {
    wc.sendInputEvent({
      type: "mouseMove",
      x: spot.x + i * 12,
      y: spot.y + i * 6,
      button: "left",
      buttons: 1,
    });
    await new Promise((r) => setTimeout(r, 40));
  }
  await new Promise((r) => setTimeout(r, 1200));

  // Mid-drag: our ghost is the only off-screen img we park at -10000px.
  console.log(
    "ghost mid-drag:",
    JSON.stringify(await wc.executeJavaScript(ghostProbe)),
  );

  press("mouseUp", spot.x + 170, spot.y + 85);
  await new Promise((r) => setTimeout(r, 800));

  console.log(
    "setDragImage calls made by THE PAGE:",
    JSON.stringify(await wc.executeJavaScript("window.__sdiCalls || []")),
  );
  console.log("setDragImage phases that ran:", JSON.stringify(phases));
  console.log("preload reported:", JSON.stringify(seen, null, 1));
  console.log(
    seen.some((s) => s && s.src)
      ? "\nOUR HANDLER FIRED"
      : "\nOUR HANDLER NEVER FIRED - the drag never reached it",
  );
  app.exit(0);
});
