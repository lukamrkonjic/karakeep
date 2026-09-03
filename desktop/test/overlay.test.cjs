// Drives the real overlay page in a renderer to check the drag interactions,
// which are behaviour the pure-function suite can't reach.
//
// The regression that matters here: expanding a folder mid-drag used to
// re-render the tree, destroying the very element the pointer was over. A
// drag doesn't survive its drop target being replaced, so hover-to-expand
// silently dropped the drag. These assertions pin the row's identity across
// an expand.
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
      fire: (label, type) => {
        const r = window.__t.rowFor(label);
        if (!r) return false;
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.dataTransfer = null;
        r.dispatchEvent(ev);
        return true;
      },
    }; true`);

  check("top-level lists render", await js(`window.__t.visible('Design')`), true);
  check(
    "subfolders start collapsed, so the panel opens compact",
    await js(`window.__t.visible('Typography')`),
    false,
  );

  // Tag the node so we can prove it's the same element afterwards.
  await js(`window.__t.rowFor('Design').dataset.probe = 'keep-me'; true`);

  await js(`window.__t.fire('Design', 'dragenter')`);
  check(
    "the hovered row highlights immediately",
    await js(`window.__t.rowFor('Design').classList.contains('over')`),
    true,
  );
  check(
    "and does not expand instantly — dwelling is required",
    await js(`window.__t.visible('Typography')`),
    false,
  );

  await sleep(450);

  check(
    "dwelling opens the folder",
    await js(`window.__t.visible('Typography')`),
    true,
  );
  check(
    "the hovered row is the SAME element, not a re-render",
    await js(`window.__t.rowFor('Design').dataset.probe`),
    "keep-me",
  );
  check(
    "so it keeps the drag highlight across the expand",
    await js(`window.__t.rowFor('Design').classList.contains('over')`),
    true,
  );
  check(
    "the chevron shows as open",
    await js(`window.__t.rowFor('Design').querySelector('.chev').classList.contains('open')`),
    true,
  );
  check(
    "an unrelated folder's children stay closed",
    await js(`window.__t.visible('Interiors')`),
    false,
  );

  // Leaving cancels the pending timer rather than opening late.
  await js(`window.__t.fire('Reference', 'dragenter'); window.__t.fire('Reference', 'dragleave'); true`);
  await sleep(450);
  check(
    "leaving before the dwell elapses cancels the expand",
    await js(`window.__t.visible('Interiors')`),
    false,
  );
  check(
    "and clears that row's highlight",
    await js(`window.__t.rowFor('Reference').classList.contains('over')`),
    false,
  );

  check(
    "the loose 'save without a list' row is a drop target too",
    await js(`window.__t.fire('Save without a list', 'dragenter')`),
    true,
  );

  // A drop carrying nothing is the Pinterest case: the site drags an empty
  // element, so there is no payload to parse and the only way through is to
  // offer a paste instead of failing.
  await js(`
    window.__t.drop = (label, dt) => {
      const r = window.__t.rowFor(label);
      const ev = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      r.dispatchEvent(ev);
    };
    window.__t.drop('Colour', new DataTransfer());
    true`);
  await sleep(200);

  check(
    "an empty drop switches the panel to the paste rescue instead of failing",
    await js(`document.getElementById('panel').classList.contains('rescuing')`),
    true,
  );
  check(
    "the rescue names the list you dropped on, so the target isn't lost",
    await js(
      `document.getElementById('rescue').textContent.includes('Colour')`,
    ),
    true,
  );
  check(
    "Escape leaves the rescue",
    await js(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.getElementById('panel').classList.contains('rescuing')`),
    false,
  );

  for (const f of failures) {
    console.error(f);
  }
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  app.exit(failures.length === 0 ? 0 : 1);
});
