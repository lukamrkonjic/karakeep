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
- **Puts the lists you actually use at the top.** Ordering is
  most-recently-used first, and using a subfolder lifts its parent too, so a
  folder you keep filing into never sinks. Lists you've never dropped into
  fall back to the web sidebar's own order, so an untouched tree looks
  familiar.
- **Opens folders under the drag.** Dwell on a folder for a moment and it
  expands in place, so you can reach an exact subfolder without letting go.
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
| `src/shared/listTree.ts` | Builds and orders the tree. Pure, so it lives in `shared/` and is tested directly. |

**Rows are built once and afterwards only shown or hidden.** This is the
non-obvious constraint in the whole UI: a drag does not survive its drop
target being replaced, so re-rendering the tree to expand a folder silently
kills the drag that triggered it. Expanding therefore only toggles classes.
`test/overlay.test.cjs` pins this by tagging the hovered row and asserting it
is the same element, still highlighted, after an expand.

The "recent" ordering is this app's own record: the server does have a
`createdAt` on lists but doesn't expose it, and `position` is already
backfilled from it, so recency here means *recently used from this app* and
lives in `settings.json`.

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

## The drag ghost is the browser's, not ours

The big translucent copy of the image that follows the cursor is drawn by
Firefox (via the drag-source half of the OS drag protocol). A drop target
receives the drag; it cannot replace, resize or remove the source's ghost.
So "make the preview a small thumbnail" isn't something this app can do.

Two things that do help:

- In Firefox, `about:config` → `nglayout.enable_drag_images` → **false**.
  That drops the translucent image entirely and leaves a small cursor, so
  the picker is never obscured. It applies to all dragging in Firefox.
- Rows here are deliberately tall and the active one is a solid filled bar,
  so the target stays readable through a translucent ghost.

Rendering our own thumbnail during the drag isn't possible either: the HTML
drag-and-drop spec puts the drag data store in *protected mode* until the
drop actually happens, so a drop target can see the list of MIME types on
dragover but not read any of the values.

## Troubleshooting a drop that didn't work

Tray → **Open drop log…**. Every drop appends what it actually carried: the
advertised MIME types, any files, the URLs the parser found, and the raw
flavour bodies. When a site's markup defeats the parser that log is the only
record of why — the data cannot be read back after the event.

## Sites that send nothing with a drag

Some sites attach nothing to a drag. Pinterest is the clearest case: the drop
arrives with **zero types and zero files**, from the very first `dragenter`.
Two independent receivers agree:

```
Pinterest, into this app:      dragenter types=[] items=0 files=0
Pinterest, into a browser page: dragenter types=[] items=0 files=0
Google Images, into this app:   types=[text/plain, text/uri-list, text/html, Files]
```

Nothing crosses the process boundary, so **no** drop target can recover it —
not this app, not Explorer, not any other tool. Every fix attempted on the
receiving side is doomed for the same reason.

`tools/drag-probe.html` is what establishes this: open it in the browser, drag
an image onto it, and it prints every flavour the page attached along with its
contents. An empty report means the site is the cause; a report with data that
this app then fails on means the bug is here.

### Copy-to-save (in the app, nothing to install)

Both of those sites *do* offer the right thing in their context menu — "Copy
image link" on Pinterest, "Copy video URL" on YouTube — and that hands over
the full-resolution URL. So the app watches for that copy and opens the same
picker; click a list and it's saved.

Two gates keep it out of the way of ordinary work, because a picker appearing
on every copy would be intolerable:

1. **The copy has to have happened in a browser.** The foreground executable
   is checked against a list of known browsers, and only once the content
   already looks worth saving — so the check runs a handful of times a day,
   not every poll.
2. **The content has to look like media.** A direct media-file URL, a page
   that *is* one piece of media (YouTube watch/shorts, a Pinterest pin, Vimeo
   …), or a copied bitmap. Prose, code, file paths, an ordinary link, a bare
   domain: all ignored. `test/clipboard.test.cjs` pins both halves, negatives
   included.

Turn it off in the tray or in Settings.

### The other route: tools/karakeep-drag-fix.user.js

The only place with enough information is the page itself, at `dragstart`,
where the `<img>` is still reachable. That script finds the image under the
cursor — looking through transparent overlays via `elementsFromPoint`, and
handling `srcset` and CSS `background-image` — and fills in the standard
flavours the site left empty. It never overwrites data a site set
deliberately, so well-behaved sites are untouched.

Two ways to run it, neither of which is a browser extension in the usual
sense:

- **Bookmarklet, nothing installed.** `npm run build` regenerates
  `tools/install-bookmarklet.html`; open it, drag the button to the bookmarks
  toolbar, and click it once on a page where dragging is broken. Pinterest is
  a single-page app, so one click generally covers a whole browsing session.
- **Userscript manager** (Violentmonkey / Tampermonkey) for the same thing
  permanently, with no per-visit click.

A plain unsigned extension is the one option that doesn't work well here:
Firefox requires signing, so it would load only temporarily via
`about:debugging` and vanish on restart.

`test/dragfix.test.cjs` pins the behaviour against a fixture reproducing the
overlay pattern — including a baseline assertion that the fixture really is
empty without the script, so the test can't pass vacuously. It also runs the
generated bookmarklet payload itself, so minification can't silently break it.

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
- **Sites vary wildly in what they put on a drag.** The parser handles
  `<img>` (including `srcset`), `<video>`/`<source>`, CSS `background-image`,
  and falls back to scanning the raw markup for a media URL. Something will
  still defeat it eventually; the drop log is how you find out what.
- **Windows-first.** The hook and the overlay are cross-platform in principle,
  but nothing here has been tested on macOS or Linux.
- **The API key is stored in plain text** in the app's user-data folder
  (`%APPDATA%/karakeep-drop/settings.json`).

## Tests

```bash
npm test
```

Runs two suites in a real Electron renderer: the drop parser and tree
ordering (`test/parse.test.ts`, needs `DOMParser`) against the flavour
combinations Firefox and Chrome actually put on a cross-application drag, and
the overlay's drag interactions (`test/overlay.test.cjs`).

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
