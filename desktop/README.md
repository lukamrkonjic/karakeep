# Karakeep Drop

A tray companion for Karakeep. Copy an image or a link in your browser, click
the tray icon, and a list picker opens by your cursor — click a list and it's
saved.

Built because the browser extension is awkward for the "I just want to keep
this picture" case. It talks to the same public REST API the extension does,
so it needs no server changes.

## What it does

- **Copy, then click the tray icon.** The picker opens right by the cursor
  (which is down at the tray, so it opens up and to the left) and a click
  files it. Nothing ever appears unless you ask for it.
- **Works on every site.** A copied URL is fetched: an image link becomes a
  real asset at full resolution; a page link (a YouTube video, say) becomes a
  bookmark the server crawls. A copied bitmap is uploaded as-is.
- **Puts the lists you actually use at the top.** Ordering is
  most-recently-used first, and using a subfolder lifts its parent too, so a
  folder you keep filing into never sinks. Lists you've never used fall back
  to the web sidebar's own order.
- **Follows the Windows light/dark theme**, in a monochrome palette matched to
  the karakeep redesign.

## Setup

```bash
cd desktop
npm install
npm start
```

On first run the settings window opens. Paste your server URL and an API key
from Karakeep's **Settings → API Keys**, then hit *Test connection*.

The app then lives in the tray. Left-click saves what you copied; right-click
gives the menu. To build a standalone installer:

```bash
npm run dist
```

## Why copy rather than drag

The obvious design is dragging an image straight out of the browser, and this
app used to work that way — a global mouse hook spotted a drag starting
anywhere on screen and popped the picker under the cursor.

Two things killed it:

- **Some sites attach nothing to a drag.** Pinterest is the clearest case: the
  drop arrives with zero types and zero files, from the very first
  `dragenter`, confirmed both here and in a plain browser page. Nothing
  crosses the process boundary, so no drop target can recover it.
- **A global mouse hook interferes with the browser's own dragging**, which is
  a bad trade for a feature that couldn't work everywhere anyway.

Copying sidesteps both. Every site that hides its image from a drag still
offers *Copy image link* in its context menu, and that hands over the
full-resolution URL. The trigger being an explicit click also means the app
never has to guess whether you meant it, so it accepts any link or image
rather than a curated list of hosts.

## How it works

| File | Role |
|---|---|
| `src/main/clipboardWatch.ts` | Reads the clipboard, and — for the optional automatic mode — decides whether something is worth interrupting for. |
| `src/main/ingest.ts` | URL or bytes → `POST /api/v1/assets` → `POST /api/v1/bookmarks` → `PUT /api/v1/lists/:id/bookmarks/:id`. |
| `src/shared/listTree.ts` | Builds and orders the tree. Pure, so it lives in `shared/` and is tested directly. |

Two details worth keeping:

- **The cursor position comes from Electron**, via
  `screen.getCursorScreenPoint()`, which is already in device-independent
  pixels. Physical pixels are wrong for window placement on a scaled display —
  on a 150% monitor every position lands half again too far.
- **The picker takes focus while open**, which is what lets it dismiss on
  click-away or Escape like any menu. It returns to non-focusable when hidden.

Note the clipboard API in use is Electron's current asynchronous one
(`readText`/`has`/`read` returning promises, `read` yielding `ClipboardItem`s).
The synchronous `readImage`/`availableFormats` no longer exist.

## Optional extras

Both off the critical path, both in the tray and in Settings:

- **A global shortcut** (`Control+Alt+S`) for the same action, when a hand is
  already on the keyboard.
- **Automatic mode**, where copying media in a browser opens the picker with
  no click at all. This one keeps a strict gate — the foreground app must be a
  browser *and* the content must look like media — because a false positive
  puts a window over your work. `test/clipboard.test.cjs` pins the negatives
  (prose, code, file paths, ordinary links) as carefully as the positives.

## Known limits

- **Cookie-gated media may fail.** The download happens outside your browser
  session, so images behind a login can 403. A browser User-Agent and a Referer
  are sent, which is enough for most hotlink checks, and anything that isn't
  fetchable media falls back to a link bookmark rather than being lost.
- **Windows-first.** Nothing here has been tested on macOS or Linux.
- **The API key is stored in plain text** in the app's user-data folder
  (`%APPDATA%/karakeep-drop/settings.json`).

## Troubleshooting

Tray → **Open drop log…**. Each save appends what happened; when something
only misbehaves against a real site, that log is the record of why.

## Tests

```bash
npm test
```

Three suites in a real Electron renderer: list ordering, the overlay's
click-to-choose behaviour, and the clipboard gate.

```bash
npx electron test/preview.cjs
```

Renders both windows in both themes to PNGs with a stubbed bridge, so the UI
can be reviewed without a running server.

## Why it lives outside the pnpm workspace

`pnpm-workspace.yaml` covers `apps/*`, `packages/*`, `tooling/*` and `tools/*`.
This app deliberately sits at `desktop/` instead, with its own `package.json`
and lockfile: the server's Docker image build runs a full workspace install,
and Electron would add a couple of hundred megabytes to every NAS image build
for something that image never runs.
