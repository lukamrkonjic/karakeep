# vrana for Mac and Windows

A native window around the vrana web app on your server, built with
[Tauri 2](https://tauri.app). Everything inside the window is the web app,
served by your server — so the app always matches what the server runs, and
updating the NAS updates the app. You only rebuild the app when this folder
changes.

It's small (about 5 MB) and uses the system's own web engine: Safari's on a
Mac, Edge's WebView2 on Windows.

## What the app adds to the web app

- **Mac: the header is the title bar.** The window buttons sit in vrana's
  header, its empty parts move the window, and a double-click zooms it.
- **Mac: closing the window keeps vrana running.** Click the Dock icon to get
  it back exactly as you left it; ⌘Q quits. (On Windows, closing quits, as
  Windows apps do, and opening it again focuses the open window.)
- **Links to other sites open in vrana's own browser window** — a picture's
  original link, say. Hold ⌘ (Ctrl on Windows) or Shift, or middle-click,
  to open one in your usual browser instead. The browser window is one
  window, reused, titled with its page; links in it stay in it, its pages
  get nothing of the app's, and closing it closes it. vrana's own links,
  even ⌘/Ctrl-clicked, open in vrana's window; its files (a picture, a PDF)
  opened as a new tab go to the browser window.
- **Downloads** go to your Downloads folder and are shown in Finder or
  Explorer.
- **Files dropped on the window** go to vrana's upload, as in the browser.
- **Theme:** the window opens in the theme vrana was last in (no white
  flash). On Windows 11 the title bar is vrana's own background, with no
  icon or title in it (the header has both), so it reads as the top of the
  page; it follows the theme.
- **The window remembers** its size and place.
- **Keys:** back / forward ⌘[ ⌘] or a two-finger swipe (Mac), Alt+← →
  (Windows); reload ⌘R / Ctrl+R; zoom ⌘+ ⌘− ⌘0 / Ctrl+ Ctrl− Ctrl0 — in
  whichever window is in front.
- **Menu (Mac):** vrana → Settings… (⌘,) and Change Server…; View → Open
  in Browser (⌘⇧O) takes the page in front to your usual browser.
- **Can't reach the server** (the NAS off, or Tailscale off on this computer):
  a page says so, with the address to try again or change.

## Build it on a Mac

You need:

- Xcode's command line tools: `xcode-select --install`
- Rust: `brew install rust` (or [rustup](https://rustup.rs))
- Node.js and pnpm, as for the rest of this repository

Then, from the repository:

```bash
pnpm install
```

```bash
cd apps/desktop && VRANA_SERVER=https://your-nas.your-tailnet.ts.net pnpm app:build
```

`VRANA_SERVER` is optional: it's the address the app opens on its first
launch. Without it, the app asks. (Either way you can change it later under
vrana → Change Server….)

The first build downloads and compiles Tauri's Rust crates: give it a few
minutes. You get:

- `apps/desktop/src-tauri/target/release/bundle/macos/vrana.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/vrana_0.1.0_aarch64.dmg`

Drag `vrana.app` into Applications. Built on the same Mac, it opens straight
away. On another Mac, right-click → Open the first time: the app isn't
notarized by Apple (that needs a paid developer account).

## Build it on Windows

You need, once:

1. **Microsoft C++ Build Tools** — install
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   and tick **Desktop development with C++**.
2. **Rust** — install it with [rustup](https://rustup.rs) (the default MSVC
   toolchain).
3. **Node.js** 24 — from [nodejs.org](https://nodejs.org). Then, in
   PowerShell: `corepack enable` (for pnpm).
4. **WebView2** — already part of Windows 10 and 11.
5. **Git**, to get the repository.

Then, in PowerShell, in the repository:

```powershell
pnpm install --filter @karakeep/desktop
```

```powershell
cd apps\desktop
$env:VRANA_SERVER = "https://your-nas.your-tailnet.ts.net"
pnpm app:build
```

(`--filter` installs only what the app needs — the Tauri command line — not
the whole repository's server packages.)

You get `apps\desktop\src-tauri\target\release\bundle\nsis\vrana_0.1.0_x64-setup.exe`:
the installer. It installs for your user only (no administrator needed), with
a Start menu entry, and fetches WebView2 itself on a Windows that lacks it.

(An MSI as well, if you ever want one: `pnpm tauri build --bundles msi`. Its
toolkit needs Windows' VBScript feature, which newer Windows 11 leaves out:
Settings → System → Optional features → add VBSCRIPT.)

The first time you run the installer, Windows SmartScreen may say "Windows
protected your PC": click **More info → Run anyway** (the app isn't signed
with a paid certificate). For a Tailscale address, Tailscale must be running
on the PC.

## Working on it

```bash
pnpm --filter @karakeep/desktop app:dev
```

opens the app from a quick debug build. To try it against a local web app
(`pnpm web`), use vrana → Change Server… and enter `http://localhost:3000`.

- `src-tauri/src/lib.rs` — the window: menu, links, downloads, theme, and
  what the server's pages may ask of the app (only to move the window, zoom
  it and report their theme).
- `src/index.html` — the app's own page: shown while it opens the server, and
  when it can't.
- `src-tauri/tauri.conf.json` — name, version, identifier and installers.
- The web app's side (`apps/web`): the `mac-app:` Tailwind variant
  (`tooling/tailwind/web.ts`) makes room for the window buttons;
  `data-tauri-drag-region` marks what moves the window (the header, the
  reader's header, and a strip along the top of every page in
  `app/layout.tsx`). None of it does anything in a browser.
- Icons: `pnpm app:icons` makes `src-tauri/icons` from `icons/icon-macos.png`
  (the Mac icon: inset, with a shadow, as macOS draws them) and
  `icons/icon-full.png` (Windows). It uses `cp` and `rm`: on Windows, run it
  in Git Bash. The icons are in git, so building never needs it.
- `src-tauri/tauri.windows.conf.json` — Windows' own settings on top of
  `tauri.conf.json` (the NSIS installer only).
- Settings (the server's address, the last theme) are in
  `~/Library/Application Support/com.lukamrkonjic.vrana/settings.json` on a
  Mac and `%APPDATA%\com.lukamrkonjic.vrana\settings.json` on Windows.

The version is in `src-tauri/tauri.conf.json` (and `Cargo.toml`); raise it
when you rebuild with changes, so installers replace the old app cleanly.
