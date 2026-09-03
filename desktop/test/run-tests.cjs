// Runs the drop-parser tests inside a real Electron renderer, since the
// parser depends on DOMParser.
const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await win.loadFile(join(__dirname, "../dist/test/parse.html"));
  const r = await win.webContents.executeJavaScript("window.__RESULTS__");
  if (!r) {
    console.error("tests did not run (bundle failed to execute)");
    app.exit(1);
    return;
  }
  for (const f of r.failures) {
    console.error(`  FAIL  ${f.name}\n        ${f.detail}`);
  }
  console.log(`\n  ${r.passed} passed, ${r.failed} failed\n`);
  app.exit(r.failed === 0 ? 0 : 1);
});
