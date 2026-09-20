/*
 * Why does a drag start on a board but not inside a pin?
 *
 * Reports, for the biggest image on the page: whether the browser will even
 * begin a drag on it, what element is actually on top of it at its centre,
 * and whether a dragstart there resolves to an image by ancestor-walking
 * alone (what the preload does today) or needs the point under the cursor.
 *
 *   npx electron test/diagnose-drag.cjs https://se.pinterest.com/pin/123/
 */
const { app, BrowserWindow, WebContentsView } = require("electron");
const { join } = require("node:path");

app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

const target = process.argv.find((a) => /^https?:\/\//i.test(a));
const settle = Number(process.env.MAGPIE_SETTLE ?? 9000);

const PROBE = `(() => {
  const imgs = [...document.images].filter((i) => i.naturalWidth > 150 && i.currentSrc);
  if (!imgs.length) return { error: "no images over 150px" };
  const img = imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
  const r = img.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);

  const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map((el) => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute("class") || "").slice(0, 24);
    return tag + (cls ? "." + cls : "");
  });

  const top = document.elementFromPoint(cx, cy);

  // What the preload does today: walk up from the drag target.
  let byAncestor = null;
  let el = top;
  for (let i = 0; el && i < 4; i++) {
    if (el.tagName === "IMG" && (el.currentSrc || el.src)) { byAncestor = el.currentSrc || el.src; break; }
    const bg = getComputedStyle(el).backgroundImage;
    const m = /url\\(["']?(.+?)["']?\\)/.exec(bg);
    if (m && m[1] && !m[1].startsWith("data:")) { byAncestor = m[1]; break; }
    el = el.parentElement;
  }

  // The proposed fallback: anything under the cursor.
  let byPoint = null;
  for (const u of document.elementsFromPoint(cx, cy)) {
    if (u.tagName === "IMG" && (u.currentSrc || u.src)) { byPoint = u.currentSrc || u.src; break; }
  }

  // And a descendant of whatever the drag would start on.
  const inner = top && top.querySelector ? top.querySelector("img") : null;

  let fired = false;
  const onStart = () => { fired = true; };
  window.addEventListener("dragstart", onStart, true);
  top.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
  window.removeEventListener("dragstart", onStart, true);

  return {
    imgSize: Math.round(r.width) + "x" + Math.round(r.height),
    imgDraggableAttr: img.getAttribute("draggable"),
    imgComputedUserDrag: getComputedStyle(img).webkitUserDrag || "(unset)",
    topElement: top ? top.tagName.toLowerCase() + "." + (top.getAttribute("class") || "").slice(0, 30) : null,
    topIsTheImage: top === img,
    topDraggableAttr: top ? top.getAttribute("draggable") : null,
    stack,
    byAncestor: byAncestor ? byAncestor.slice(0, 60) : null,
    byPoint: byPoint ? byPoint.slice(0, 60) : null,
    byDescendant: inner ? (inner.currentSrc || inner.src).slice(0, 60) : null,
    syntheticDragstartReached: fired,
    anchorAncestor: (() => {
      let a = top;
      for (let i = 0; a && i < 6; i++) { if (a.tagName === "A") return a.getAttribute("href"); a = a.parentElement; }
      return null;
    })(),
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
  view.setBounds({ x: 0, y: 78, width: 1280, height: 792 });

  const wc = view.webContents;
  // Mirror what the real browser does on every document.
  wc.on("dom-ready", () => {
    void wc
      .insertCSS("img, picture, a img { -webkit-user-drag: element !important; }")
      .catch(() => {});
  });
  await wc.loadURL(target);
  await new Promise((r) => setTimeout(r, settle));

  try {
    const before = await wc.executeJavaScript(PROBE);
    console.log("--- before a mousedown ---");
    for (const k of ["imgDraggableAttr", "imgComputedUserDrag"]) {
      console.log(String(k).padEnd(26), JSON.stringify(before[k]));
    }

    // A real mousedown, which is what the preload hangs the attribute flip
    // on. Dispatched rather than physical, but it travels the same listener.
    await wc.executeJavaScript(`(() => {
      const imgs = [...document.images].filter((i) => i.naturalWidth > 150 && i.currentSrc);
      const img = imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
      const r = img.getBoundingClientRect();
      img.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      }));
      return true;
    })()`);

    console.log("--- after a mousedown ---");
    const out = await wc.executeJavaScript(PROBE);
    for (const [k, v] of Object.entries(out)) {
      console.log(String(k).padEnd(26), JSON.stringify(v));
    }
  } catch (e) {
    console.error("probe failed:", e.message);
  }
  app.exit(0);
});
