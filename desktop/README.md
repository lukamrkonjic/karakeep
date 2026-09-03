# Karakeep Drop

An Eagle-style desktop companion for Karakeep. Start dragging an image or
video anywhere on screen; a list picker appears under the cursor; drop it on a
list and it's uploaded and filed.

Built because the browser extension is awkward for the "I just want to keep
this picture" case. It talks to the same public REST API the extension does,
so it needs no server changes.

## What it does

- **Watches for drags globally.** Press the left mouse button and move past a
  threshold and the picker appears right next to the cursor — about a
  centimetre away, so filing is a flick rather than a trip across the screen.
  No hotkey, no window to find first.
- **Shows your real list tree**, ordered exactly like the web sidebar
  (`position` descending), with hover-to-expand so you can drop into a
  subfolder without letting go.
- **Handles browser drags, not just files.** A drag out of Firefox or Chrome
  usually carries a URL rather than bytes, so the app reads every flavour the
  browser offers (`text/html`, `text/uri-list`, `text/x-moz-url`,
  `text/plain`), picks the best media URL, and downloads it.
- **Keeps the source URL** on the bookmark, which a naive uploader loses.
- **Falls back to a link bookmark** when the media can't be fetched, so a drop
  is never silently lost.
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

The app then lives in the tray. Right-click it for the on/off switch, *Start
with Windows* (off by default), and settings.

To build a standalone installer:

```bash
npm run dist
```

## How it works

Three files carry most of the weight:

| File | Role |
|---|---|
| `src/main/dragWatch.ts` | The global hook. Windows has no "a drag started" event, so this infers one from *left button down → cursor moved past a threshold while still held* — the same heuristic Eagle uses. |
| `src/shared/dropParse.ts` | Turns a `DataTransfer` into an ordered list of candidate media URLs. This is the fiddly part; it has its own test suite. |
| `src/main/ingest.ts` | Bytes → `POST /api/v1/assets` → `POST /api/v1/bookmarks` → `PUT /api/v1/lists/:id/bookmarks/:id`. |

Two placement details are easy to get wrong and worth keeping:

- **The cursor position comes from Electron, not the hook.** `uiohook` reports
  *physical* pixels while `setBounds` takes *device-independent* ones, so on a
  scaled display (150% here) every position was off by half again and the
  panel ended up pinned to the right screen edge. `screen.getCursorScreenPoint()`
  is already in DIP.
- **Near an edge the panel flips rather than slides.** Clamping it into the
  work area is what strands it far from the cursor on a wide monitor.

## Theming

Both themes are plain CSS: one palette on `:root`, the dark overrides under
`@media (prefers-color-scheme: dark)`. Electron already tracks the Windows app
theme and re-evaluates that query live, so nothing in the main process is
involved — except the tray bitmap, which has no template-image concept on
Windows and so is swapped between a dark and a light mark on
`nativeTheme.on("updated")`.

The overlay is shown with `showInactive()` and created with `focusable: false`
— taking focus mid-drag can cancel the drag outright.

## Known limits

- **Cookie-gated media may fail.** When a drag hands over a URL instead of
  bytes, the download happens outside your browser session, so images behind a
  login (some Instagram/Discord/Patreon URLs) can 403 where the extension
  succeeds. The app sends a browser User-Agent and a Referer — derived from the
  page when the browser provides one, otherwise from the media's own origin —
  which is enough for most hotlink checks, and falls back to a link bookmark
  when it isn't.
- **The picker appears on any drag,** including text selection. Raise the
  threshold, or switch to *Only while holding a key* in settings.
- **Windows-first.** The hook and the overlay are cross-platform in principle,
  but nothing here has been tested on macOS or Linux.
- **The API key is stored in plain text** in the app's user-data folder
  (`%APPDATA%/karakeep-drop/settings.json`).

## Tests

```bash
npm test
```

Runs the drop-parser suite inside a real Electron renderer (it needs
`DOMParser`) against the flavour combinations Firefox and Chrome actually put
on a cross-application drag.

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
