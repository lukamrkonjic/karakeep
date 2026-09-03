// Renders the two windows to PNG with a stubbed bridge, so the UI can be
// reviewed without a running Karakeep server.
//   npx electron test/preview.cjs
const { app, BrowserWindow, nativeTheme } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot({ file, width, height, out, expand, over, rescue, theme }) {
  // Forcing the source lets one run capture both themes; the renderers pick
  // it up through prefers-color-scheme exactly as they do from Windows.
  nativeTheme.themeSource = theme;
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
        `document.querySelectorAll('.chev:not(.chev-empty):not(.open)')[0]
           ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true`,
      );
      await sleep(300);
    }
    if (rescue) {
      await win.webContents.executeJavaScript(`
        const r = Array.from(document.querySelectorAll('.row'))
          .find((x) => x.querySelector('.name')?.textContent === 'Colour');
        const ev = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'dataTransfer', { value: new DataTransfer() });
        r.dispatchEvent(ev);
        true`);
      await sleep(250);
    }
    if (over) {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.row:not(.collapsed)')[2]?.classList.add('over'); true`,
      );
    }
    // A hidden window composites lazily, so give the class changes (and the
    // chevron's transition) a couple of frames before grabbing the pixels.
    await win.webContents.executeJavaScript(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
    );
    await sleep(400);
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
    for (const theme of ["light", "dark"]) {
      await shoot({
        file: "overlay.html",
        width: 260,
        height: 340,
        out: `preview-overlay-${theme}.png`,
        expand: true,
        theme,
      });
      await shoot({
        file: "overlay.html",
        width: 260,
        height: 340,
        out: `preview-overlay-${theme}-over.png`,
        expand: true,
        over: true,
        theme,
      });
      await shoot({
        file: "overlay.html",
        width: 272,
        height: 380,
        out: `preview-rescue-${theme}.png`,
        expand: true,
        rescue: true,
        theme,
      });
      await shoot({
        file: "settings.html",
        width: 520,
        height: 720,
        out: `preview-settings-${theme}.png`,
        expand: false,
        theme,
      });
    }
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
