/*
 * Why does a page render for a moment and then go white?
 *
 * Two very different causes look identical on screen:
 *   - the DOM is emptied or hidden (the page, or a cosmetic filter, did it)
 *   - the DOM is fine and the view simply stops painting (compositing)
 *
 * So this samples the DOM over time AND screenshots at the end. If innerText
 * stays long while the shot is white, it is painting, not content.
 *
 *   npx electron test/diagnose-blank.cjs https://www.pinterest.com/ideas/
 *   MAGPIE_ADBLOCK=0 npx electron test/diagnose-blank.cjs <url>
 */
const { app, BrowserWindow, WebContentsView, session } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

const target =
  process.argv.find((a) => /^https?:\/\//i.test(a)) ??
  "https://www.pinterest.com/ideas/";
const useAdblock = process.env.MAGPIE_ADBLOCK !== "0";
const shot = process.env.MAGPIE_SHOT;

const PROBE = `(() => {
  const b = document.body;
  if (!b) return { ready: document.readyState, note: "no body" };
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const html = document.documentElement;
  const hs = getComputedStyle(html);
  return {
    ready: document.readyState,
    text: (b.innerText || "").length,
    kids: b.children.length,
    bodyDisplay: cs.display,
    bodyVisibility: cs.visibility,
    bodyOpacity: cs.opacity,
    htmlDisplay: hs.display,
    rect: Math.round(r.width) + "x" + Math.round(r.height),
    scrollH: html.scrollHeight,
    injectedStyles: document.querySelectorAll('style').length,
  };
})()`;

async function main() {
  const sess = session.fromPartition("persist:magpie");

  if (useAdblock) {
    const { ElectronBlocker } = require("@ghostery/adblocker-electron");
    const { readFile, writeFile } = require("node:fs/promises");
    const level = process.env.MAGPIE_ADBLOCK || "full";
    const make = {
      ads: ElectronBlocker.fromPrebuiltAdsOnly,
      adstracking: ElectronBlocker.fromPrebuiltAdsAndTracking,
      full: ElectronBlocker.fromPrebuiltFull,
    }[level];
    const blocker = await make.call(ElectronBlocker, fetch, {
      path: join(app.getPath("userData"), `adblock-${level}.bin`),
      read: readFile,
      write: writeFile,
    });
    blocker.enableBlockingInSession(sess);
    console.log("adblock:", level);
  } else {
    console.log("adblock: OFF");
  }

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
  // Same inset the real chrome uses, so the geometry matches.
  view.setBounds({ x: 0, y: 78, width: 1280, height: 900 - 78 - 30 });

  const wc = view.webContents;
  wc.on("console-message", (_e, level, message) => {
    if (/error|blocked|refused/i.test(message)) {
      console.log("  page console:", message.slice(0, 160));
    }
  });

  console.log("loading", target);
  await wc.loadURL(target);

  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 750));
    let p;
    try {
      p = await wc.executeJavaScript(PROBE);
    } catch (e) {
      p = { error: e.message };
    }
    console.log(
      `t+${((i + 1) * 0.75).toFixed(2)}s`,
      JSON.stringify(p),
    );
  }

  if (shot) {
    try {
      writeFileSync(shot, (await wc.capturePage()).toPNG());
      console.log("shot written:", shot);
    } catch (e) {
      console.log("shot failed:", e.message);
    }
  }

  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error("FAILED:", e);
    app.exit(1);
  }),
);
