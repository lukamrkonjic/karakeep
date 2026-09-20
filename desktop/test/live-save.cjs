/*
 * Manual harness. Archives a real URL into the configured Karakeep, using the
 * same session the collector browser uses — so whatever you are logged into
 * in that window is what gets captured.
 *
 * Deliberately NOT part of `npm test`: it writes a real bookmark.
 *
 *   npx electron test/live-save.cjs https://www.pinterest.com/
 *
 * MAGPIE_SETTLE   ms to let the page finish rendering (default 8000)
 * MAGPIE_IFEXISTS skip | overwrite | append (default overwrite)
 * MAGPIE_DUMP     also write the archive HTML here, to eyeball it
 */
const { app, BrowserWindow, WebContentsView } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

// The settings file lives under the product name, not Electron's default, so
// this has to match what main.ts pins or the server URL and key go missing.
app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

const { capturePage, registerCaptureBridge } = require("../dist/main/archive.cjs");
const { uploadSinglefileArchive } = require("../dist/main/karakeep.cjs");
const { getSettings } = require("../dist/main/config.cjs");

const target = process.argv.find((a) => /^https?:\/\//i.test(a));
const settle = Number(process.env.MAGPIE_SETTLE ?? 8000);

async function main() {
  if (!target) {
    console.error("give me a URL");
    app.exit(2);
    return;
  }

  const { serverUrl } = getSettings();
  console.log(`server   ${serverUrl}`);
  console.log(`target   ${target}`);

  // Shown on purpose: a window that never paints runs no rAF, so a page
  // that renders itself with JavaScript is still blank when the capture
  // starts. This harness has to be as real as the browser it stands in for.
  const win = new BrowserWindow({ show: true, width: 1280, height: 900 });
  const view = new WebContentsView({
    webPreferences: {
      // The collector browser's own partition, so its logins apply here.
      partition: "persist:magpie",
      preload: join(__dirname, "../dist/preload/capturePreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });

  const wc = view.webContents;
  await wc.loadURL(target);
  console.log(`loaded   ${wc.getURL()}`);
  await new Promise((r) => setTimeout(r, settle));

  console.time("capture");
  const shot = await capturePage(wc);
  console.timeEnd("capture");
  const kb = Math.round(shot.html.length / 1024);
  console.log(`captured ${kb} KB  title: ${shot.title}`);

  if (process.env.MAGPIE_DUMP) {
    writeFileSync(process.env.MAGPIE_DUMP, shot.html);
    console.log(`dumped   ${process.env.MAGPIE_DUMP}`);
  }

  console.time("upload");
  const bookmark = await uploadSinglefileArchive({
    html: shot.html,
    url: shot.url,
    ifExists: process.env.MAGPIE_IFEXISTS ?? "overwrite",
  });
  console.timeEnd("upload");

  console.log(
    `\nsaved    ${bookmark.id}${bookmark.alreadyExists ? "  (already existed, archive replaced)" : ""}`,
  );
  console.log(`open     ${serverUrl}/dashboard/preview/${bookmark.id}`);
  app.exit(0);
}

app.whenReady().then(() => {
  registerCaptureBridge();
  main().catch((e) => {
    console.error("\nFAILED:", e && e.message ? e.message : e);
    app.exit(1);
  });
});
