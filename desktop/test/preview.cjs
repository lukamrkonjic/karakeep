// Renders the two windows to PNG with a stubbed bridge, so the UI can be
// reviewed without a running Karakeep server.
//   npx electron test/preview.cjs
const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot({ file, width, height, out, expand }) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, "preview-preload.cjs"),
      contextIsolation: true,
    },
  });
  try {
    await win.loadFile(join(__dirname, "../dist/renderer/", file));
    await sleep(700);
    if (expand) {
      // Open every collapsed folder so the nesting shows up in the shot.
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.chev').forEach((c) => {
           if (c.textContent === '▸') {
             c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
           }
         }); true`,
      );
      await sleep(300);
    }
    const img = await win.webContents.capturePage();
    writeFileSync(join(__dirname, "..", out), img.toPNG());
    console.log(`wrote ${out}`);
  } finally {
    win.destroy();
    await sleep(200);
  }
}

// Each shot destroys its window; without this, closing the first one trips
// Electron's default "last window closed" quit and the run ends silently.
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  try {
    await shoot({
      file: "overlay.html",
      width: 300,
      height: 380,
      out: "preview-overlay.png",
      expand: true,
    });
    await shoot({
      file: "settings.html",
      width: 520,
      height: 660,
      out: "preview-settings.png",
      expand: false,
    });
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
