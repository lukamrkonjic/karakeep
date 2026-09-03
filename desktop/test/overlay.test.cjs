// Drives the real overlay page in a renderer: tree expansion, and the
// click-to-choose behaviour the picker uses once something has been copied.
const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
let passed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failures.push(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
  }
}

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 260,
    height: 340,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preview-preload.cjs"),
      contextIsolation: true,
    },
  });
  await win.loadFile(join(__dirname, "../dist/renderer/overlay.html"));
  await sleep(600);

  const js = (code) => win.webContents.executeJavaScript(code);

  // Helpers injected once; `rowFor` finds a row by its visible label.
  await js(`
    window.__t = {
      rows: () => Array.from(document.querySelectorAll('.row')),
      rowFor: (label) => window.__t.rows().find(
        (r) => r.querySelector('.name')?.textContent === label),
      visible: (label) => {
        const r = window.__t.rowFor(label);
        return !!r && !r.classList.contains('collapsed');
      },
    }; true`);

  check("top-level lists render", await js(`window.__t.visible('Design')`), true);
  check(
    "subfolders start collapsed, so the panel opens compact",
    await js(`window.__t.visible('Typography')`),
    false,
  );

  // Tag the node so we can prove expanding doesn't rebuild the tree.
  await js(`window.__t.rowFor('Design').dataset.probe = 'keep-me'; true`);
  await js(`window.__t.rowFor('Design').querySelector('.chev')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true`);

  check(
    "the chevron expands the folder",
    await js(`window.__t.visible('Typography')`),
    true,
  );
  check(
    "and the row is the same element, not a re-render",
    await js(`window.__t.rowFor('Design').dataset.probe`),
    "keep-me",
  );
  check(
    "an unrelated folder's children stay closed",
    await js(`window.__t.visible('Interiors')`),
    false,
  );

  // Copy-to-save: the same picker, opened by a copy rather than a drag, so
  // rows are chosen by clicking. Clicking must do nothing until that mode is
  // on, or an ordinary drag would fire a save on mouse-up.
  await js(`window.__t.rowFor('Film stills').click(); true`);
  check(
    "clicking a row does nothing outside copy mode",
    await js(`window.__test.saved().length`),
    0,
  );

  await js(`window.__test.enterCopyMode('url'); true`);
  check(
    "copy mode marks the panel, so rows show they're clickable",
    await js(`document.getElementById('panel').classList.contains('copy-mode')`),
    true,
  );
  check(
    "and says what will be saved",
    await js(`document.getElementById('status').textContent`),
    "Save copied link to…",
  );

  await js(`window.__t.rowFor('Film stills').click(); true`);
  await sleep(120);
  check(
    "clicking a row in copy mode saves into that list",
    await js(`JSON.stringify(window.__test.saved().slice(-1))`),
    JSON.stringify([{ listId: "3", listName: "Film stills" }]),
  );
  check(
    "a second click can't double-save",
    await js(`window.__t.rowFor('Film stills').click(); window.__test.saved().length`),
    1,
  );

  // Opened deliberately from the tray, so it dismisses like a menu.
  await js(`window.__test.enterCopyMode('image'); true`);
  check(
    "Escape leaves copy mode",
    await js(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.getElementById('panel').classList.contains('copy-mode')`),
    false,
  );
  check(
    "and a click afterwards no longer saves",
    await js(`window.__t.rowFor('To sort').click(); window.__test.saved().length`),
    1,
  );

  for (const f of failures) {
    console.error(f);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  app.exit(failures.length === 0 ? 0 : 1);
});
