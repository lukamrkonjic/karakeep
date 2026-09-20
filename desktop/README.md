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

## Building an app you can install

```bash
npm run dist
```

Writes `release/Magpie Setup 0.1.0.exe` (an installer) and
`release/Magpie 0.1.0.exe` (portable, no install). The icon comes from
`build/icon.ico`, which is generated rather than drawn by hand:

```bash
npx electron tools/make-icon.cjs
```

That renders the mark in a real Electron window — the same engine that draws
the rest of the app, so the icon cannot drift from the interface it belongs
to — then packs the sizes into an `.ico` directly, since the format takes
PNG-encoded entries and needs no image library.

### Connection details compiled in

`src/shared/defaults.ts` holds a server URL and an API key that the build is
compiled with, so a fresh install works the moment it opens instead of asking
to be set up. Anything saved in Settings wins over them, and clearing a field
falls back to them again.

That file is **not in git** — an API key committed to a fork of a public
repository stays in its history forever. `defaults.example.ts` is the tracked
copy, and the build writes an empty `defaults.ts` from it when one is missing,
so a fresh clone still builds and simply asks for a server and a key.

The key is still stored in plain text in the user-data folder, and now also
inside the packaged app, so treat the installer as something that carries a
password. Settings shows the key behind a **Show** toggle with a **Copy**
button beside it.

## Setup

```bash
cd desktop
npm install
npm start
```

On first run the settings window opens. Paste your server URL and an API key
from Karakeep's **Settings → API Keys**, then hit *Test connection*.

Archiving needs that key to carry both `assets:readwrite` and
`bookmarks:readwrite`. A key missing one gets a 403 that says which.

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

## The collector browser

Tray → **Open the collector browser**, or run `npm start -- --browser`.

It is a browser window with one job. `Ctrl+S` archives the page you are
looking at; right-click gives **Save image / video / link / selection**. Ad and
tracker blocking is on, and the bottom bar is the only feedback — a save lands
there with a tag field and an Undo, and fades on its own after nine seconds.

Nothing blocks on a form. The save is already committed by the time the bar
offers to tag it, which is the one thing the extension gets wrong.

### The window

No system title bar. The whole top of the window drags it — the tab strip, the
toolbar and the bookmarks bar — and the controls inside punch holes in that.
Doing it the other way round is what makes a frameless window feel stuck:
marking a *container* no-drag leaves almost nothing to grab, because the tab
strip fills the title bar. Minimise, maximise and close sit at the right end,
and Windows 11 rounds the corners on its own.

The toolbar holds the address bar, **Save page**, and one `⋯` for everything
that is not browsing — ad blocking lives in there now rather than as a switch
taking up room next to the thing the browser is actually for.

The page is inset by a gutter on all sides with its corners rounded
(`WebContentsView.setBorderRadius`), so it reads as a card sitting on the
browser rather than as the browser itself. The chrome shows through the
gutter, which is also where the status bar lives.

Those heights are load-bearing in two places at once: the stylesheet lays the
chrome out and the main process insets the page by exactly the same amount, so
a change to one is a change to both.

### Pinned pages

Archiving a page also pins it to the head of the tab strip, as a favicon-only
tab — a page worth keeping is a page worth getting back to. A dozen of them
still cost less room than the row of chrome a bookmarks bar would take, and
the icon is what you aim at anyway.

Clicking one behaves like a pinned tab: it goes to the tab already showing
that page, or uses the blank tab you are sitting on, or opens a new one. It
never replaces something you were reading. Right-click gives **Open this when
Magpie starts** (the pin that wins is shown filled), **Open in a new tab**,
and **Remove**.

The favicon is fetched through the tab's session and stored as a `data:` URL
rather than linked, so the strip draws with no network, keeps working when the
site is down, and needs no loosening of the chrome's content security policy.

### Saving a page

`Ctrl+S`, **right-click a tab → Save this page to Karakeep**, or the `⋯` menu.
There is no button for it in the toolbar: the toolbar is the address bar, and
a thing you do to a tab belongs on the tab.

### Saving something twice

Archiving a page, saving an image from the context menu, or dropping one on
the panel all check Karakeep first, and ask before making a second copy. A
page offers to update its archive, keep both versions, open the one you have,
or cancel; an image offers a duplicate, the one you have, or cancel. The
harmless button is the default, so a stray Return never duplicates anything.

The check is a search for `url:"..."`, not the dedicated
`/bookmarks/check-url` endpoint. That endpoint only queries *link* bookmarks,
which makes every saved image invisible to it; the search's `url:` matcher
covers a link's own URL **and** an asset's `sourceUrl`, so one call answers
for a page and for a picture alike. It matches on substring, server side, so
it errs towards asking.

A lookup that fails goes ahead with the save. Not being able to reach the
server is no reason to refuse to keep something.

### Dragging an image to file it

Pick up any image in a tab and a panel appears: a big loose half on the left
that keeps it with no list, the lists you have filed into most recently on the
right, and **Choose a list…** at the bottom. Drop on any of them.

Dropping on *Choose a list…* does not file anything — it turns the panel into
an explorer. An empty search box browses your whole list tree with the same
ordering the web sidebar uses, typing searches it, and Enter takes the top
match. That only works after the drag is over, which is exactly when it opens:
you cannot type mid-drag.

This is the feature *Why copy rather than drag* below gave up on, and it works
here for the reason that section could not rely on: **the drag's payload is
never read.** A preload in the tab sees `dragstart`, walks up a few ancestors
for an `<img>`, and takes its `currentSrc` — the resolved, full-resolution URL
the browser actually fetched — straight out of the DOM. Pinterest attaching
nothing to the DataTransfer stops mattering the moment the image is one you
are already rendering. The listener is in the capture phase, so a page that
cancels its own `dragstart` is seen anyway, and the fetch that follows goes
through the tab's session, so a login applies.

The image itself rides under the cursor while you carry it: `setDragImage`
with a 150px clone of it, centred on the pointer. Chromium's own drag image is
the element at its rendered size, which for a full-width pin is an unwieldy
slab and reads as a dragged *object* rather than a thing being placed.

Two things about that are easy to get wrong, and both were:

- **A clone, not a canvas.** Drawing a cross-origin pin into a canvas taints
  it, and a tainted canvas is refused as a drag image — silently, so the drag
  simply has no picture on it.
- **Set twice: once in the capture phase and once, last, in the bubble.**
  Neither alone is enough. Chromium snapshots whatever was set last before
  `dragstart` finishes dispatching, so a page that sets its own would beat a
  lone capture-phase call — but a pin page calls `stopPropagation()`, and then
  the event never bubbles back to `window` at all and a lone bubble-phase call
  never happens. That is exactly why the drag preview worked on a board and
  not inside a pin. The late call is registered *during* dispatch, which
  appends it to the end of `window`'s bubble listeners, so it lands after
  anything the page registered at load time.
- **Built at `mousedown`, not at `dragstart`.** The snapshot is taken after
  `dragstart` returns, and an element created inside that handler has had no
  layout and no decode yet, so what gets copied is empty and Chromium falls
  back to its own image without complaining. A mousedown is hundreds of
  milliseconds ahead of the drag, which is all the element needs.

Finding the image under the cursor is one shared routine, used both to prepare
the ghost and to resolve the drag, so a board and a pin behave the same.
`elementsFromPoint` alone is not enough — it skips anything with
`pointer-events: none`, which is exactly how a grid stops its pictures
swallowing clicks meant for the card. When the stack holds no image, geometry
answers instead: the smallest image whose box covers the point.

The panel is drawn the instant the drag begins, from lists already in hand,
and takes a second message when fresh ones arrive. Waiting for the server
first made it miss short drags entirely — the drag was over before the card
faded in, which looks exactly like the feature not working. The view itself is
built when the window opens rather than on first use, for the same reason: a
page load is far too slow to start once someone is already dragging.

The panel closes on Escape, on a click outside the card, on a drop, or shortly
after `dragend` — deferred just far enough that a drop landing on it wins the
race.

The view behind it is transparent and fills the window, rather than being
sized to the card. That is what lets the card fade and lift into place over a
dimmed page: a view sized to the card could only ever jump between two
rectangles, and would leave nowhere to put the scrim that tells you the page
underneath is not the target. Switching to the explorer is a CSS size change
on the same card for the same reason.

Two things had to be undone first, and they are the same bug wearing different
clothes. Pinterest marks its pin images `draggable="false"` **and**
`-webkit-user-drag: none`, so Chromium refuses to begin a drag on them and no
`dragstart` ever fires — a pin page felt completely dead while a board worked.
On a board the browser falls back to dragging the surrounding `<a href="/pin/…">`
instead, and dropping a link onto a page is a navigation, which is why a drag
that missed sometimes loaded the pin.

So: the CSS is overridden from the main process with `insertCSS` on every
`dom-ready`, which lands outside the page's own stylesheets; the attribute is
flipped at `mousedown`, touching only the element under the cursor, so a React
re-render that puts it back is simply undone the next time you reach for it;
and while one of our drags is in flight the page refuses to be a drop target
at all, so missing the panel means nothing happens instead of navigating.

### Why a browser and not a better extension

The tray flow downloads media from outside your browser session, so anything
behind a login can 403 — the last entry under *Known limits*, and not fixable
from a tray. A page you are looking at inside this window is already past the
login, the paywall and the consent wall, so its cookies fetch what the
server's own crawler never can.

That is also why `Ctrl+S` sends a **SingleFile capture** rather than a URL.
The server crawls a URL anonymously from wherever Karakeep runs; this uploads
the DOM as it stands in front of you — scrolled, expanded, signed in — to
`POST /bookmarks/singlefile`, which stores it as the bookmark's
`precrawledArchive`. Re-saving a page overwrites that archive rather than
making a duplicate.

### How the capture stays safe

SingleFile has to fetch subresources, and cross-origin ones are exactly what
the page itself cannot read. So the fetch happens in the main process, over
the tab's own session, and is handed to the capture through
`contextBridge.exposeInIsolatedWorld` — never `exposeInMainWorld`, which would
give every site you visit a credentialed fetch for every other site.

Two things keep that honest, and `test/capture.test.cjs` pins both:

- The bridge lives in an isolated world, so the page cannot reach it. The test
  asserts `window.__magpie` is undefined in the page's own world.
- The main process refuses the channel unless a capture it started is in
  flight, so it is open for the second or two after you press `Ctrl+S` and
  shut the rest of the time.

The test proves the whole path with no Karakeep server involved: it serves an
image from a second port with no CORS headers at all, and asserts it comes
back inlined as a `data:` URI. Nothing running in the page could have fetched
that.

### Known browser limits

- **Subframes are injected in their own world**, because only `WebContents`
  can reach an isolated one. That script carries no privilege — it serialises
  its frame and answers `postMessage` — but a hostile page could interfere
  with how its iframes archive. The credentialed fetch stays in the top frame.
- **No Widevine**, so Netflix and Spotify will not play. Irrelevant for
  collecting.
- **Google sign-in sometimes refuses embedded browsers**, so a few Google
  logins may not carry over. The session's user agent has its Electron and app
  tokens stripped, which leaves an ordinary Chrome string and is the
  difference between a login that sticks and one that does not — but Google in
  particular looks at more than the user agent.
- **Ctrl+S and the context menu still save loose.** Only a drag offers the
  list panel; a page archive or a right-click save lands with no list and gets
  tagged from the bottom bar.
- **List icons are read, not repaired.** Several on this server are stored as
  a literal `??` — emoji that went through a non-UTF-8 encoding somewhere long
  before this app. An icon with no non-ASCII character in it is treated as no
  icon rather than drawn.
- **No offline queue yet.** A save made while the server is unreachable fails
  and says so, rather than waiting for it to come back.
- **The tab has to be painting.** A minimised window renders nothing and runs
  no lazy loading, so a capture taken then would be a stylesheet wrapped
  around an empty body. That is checked for and refused rather than filed,
  because a silently empty archive looks saved. It is also why
  `removeHiddenElements` is off: it decides what is hidden from computed
  layout, and an unpainted tab reports everything as hidden.
- **No uBlock Origin, and it is not a near miss.** uBO proper is Manifest V2,
  which Chromium removed outright, so Electron cannot load it at any version.
  uBO Lite is Manifest V3 and blocks through `chrome.declarativeNetRequest`,
  which Electron does not implement — and Electron states that matching
  Chrome's extension support is a non-goal. The Ghostery engine here reads the
  same EasyList and uBO filter lists; what differs is the engine running them,
  not the rules.
- **Blocking starts off, and lives in the `⋯` menu.** The Ghostery engine breaks
  some sites outright — Pinterest renders an empty shell with it on, measured
  identical at all three filter levels (`AdsOnly`, `AdsAndTracking`, `Full`),
  while uBlock Origin has no trouble with the same site. So this is the
  engine's Electron integration, not the lists. A browser that shows blank
  pages out of the box is broken, so it starts off; the button turns it on and
  reloads, because blocking is decided as requests are made and a page already
  on screen will not change until it is fetched again.
- **YouTube ad blocking is weaker than real uBlock Origin**, and a few
  strict-CSP sites defeat scriptlet injection.
- The adblocker occasionally logs an unhandled rejection from its own cosmetic
  injection when a page navigates mid-inject. It is noise, not a failure.

### Signing in

Tabs run in their own persistent partition (`persist:magpie`), so a sign-in is
written to disk at
`%APPDATA%/karakeep-drop/Partitions/magpie/Network/Cookies` and survives restarts
indefinitely. Nothing in this app ever clears it. Sign in once, inside the
window, and every later capture of that site is a signed-in capture — which is
the whole reason the browser is here.

### Reviewing it without a mouse

```bash
MAGPIE_URL=https://example.com npm start -- --shot=C:/tmp/look.png
```

Writes the chrome to `look.png` and the active tab to `look-page.png`, then
quits. They are two files because `capturePage` only exists on `WebContents`,
and the chrome's contents never include the tab views stacked over them — the
middle of a chrome capture is always the empty region the views cover.

To archive a real URL into the configured server without touching the UI:

```bash
npx electron test/live-save.cjs https://www.pinterest.com/
```

It uses the collector browser's own `persist:magpie` session, so whatever you
are signed into in that window is what gets captured. `MAGPIE_DUMP=out.html`
also writes the archive to disk, which is the quickest way to tell a good
capture from a thin one — check that the body has text and inlined
`data:image` entries rather than trusting the byte count.

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
  fetchable media falls back to a link bookmark rather than being lost. Saving
  the same thing from *inside* the collector browser has no such problem: it
  fetches through the tab's own session.
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

Four suites in a real Electron: list ordering, the overlay's
click-to-choose behaviour, the clipboard gate, and the page capture — which
proves a cross-origin resource is inlined with no Karakeep server involved.

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
