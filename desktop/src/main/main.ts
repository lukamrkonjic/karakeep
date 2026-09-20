import { join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  globalShortcut,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
} from "electron";

import { getSettings, isConfigured, saveSettings } from "./config";
import {
  acknowledgeClipboard,
  Copied,
  readClipboard,
  startClipboardWatch,
  stopClipboardWatch,
} from "./clipboardWatch";
import {
  captureWindow,
  demoDrag,
  demoDropLoose,
  demoExplore,
  demoRealDrag,
  demoSavePage,
  openBrowser,
  registerBrowserIpc,
  setSettingsOpener,
} from "./browser";
import { dropLogPath, logLine } from "./dropLog";
import { ingestClipboard } from "./ingest";
import { fetchLists, testConnection } from "./karakeep";
import { buildTree } from "../shared/listTree";
import { ClipboardIngestRequest, ListNode, Settings } from "../shared/types";

const OVERLAY_W = 272;
const OVERLAY_H = 380;
/** How far the panel sits from the cursor when it opens. */
const CURSOR_OFFSET = 10;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

/**
 * A single-colour mark, inverted for the theme so it stays legible on either
 * taskbar. Windows has no template-image concept, so we swap the file.
 */
const iconPath = (): string =>
  join(
    __dirname,
    nativeTheme.shouldUseDarkColors
      ? "../renderer/icon-light.png"
      : "../renderer/icon-dark.png",
  );

// Packaged, app.getName() is the productName ("Karakeep Drop"), which would
// point userData somewhere different from the unpackaged run and lose the
// server URL and API key. Pin it so both use the same folder.
app.setPath("userData", join(app.getPath("appData"), "karakeep-drop"));

// A second instance would fight the first over the tray icon and the global
// shortcut, so hand off to the one already running.
/*
 * A second launch hands off to the instance already running and must then
 * stop. app.quit() only *asks* to close: the module goes on evaluating and
 * whenReady still fires, so without this guard the doomed process builds a
 * tray, a window and an IPC surface of its own and races its own shutdown.
 * What you get is a window that draws but whose tab never loads and whose
 * address bar does nothing.
 */
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
}

/** Matches the renderer's --bg so the frame never flashes a different colour. */
function panelBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#191919" : "#ffffff";
}

function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    show: false,
    frame: false,
    // Deliberately NOT transparent. A transparent window is a documented
    // source of input quirks on Windows, and this panel is opaque anyway —
    // Windows 11 rounds a frameless window's corners on its own. Drops were
    // arriving with a completely empty DataTransfer while it was set.
    backgroundColor: panelBackground(),
    roundedCorners: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    // Focus is taken only while the picker is open (see showOverlayForCopy),
    // so it can dismiss on blur like a menu.
    focusable: false,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // "screen-saver" is the level that clears full-screen browser windows.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Only ever focused in copy mode; clicking away then dismisses it.
  win.on("blur", () => {
    if (win.isVisible() && win.isFocusable()) {
      void acknowledgeClipboard();
      hideOverlay();
    }
  });
  void win.loadFile(join(__dirname, "../renderer/overlay.html"));
  return win;
}

/**
 * Places the panel just off the cursor, flipping to the other side when it
 * would run off the display rather than sliding along the edge. Clicking the
 * tray puts the cursor at the bottom-right, so in practice it opens up and to
 * the left.
 */
function overlayPositionFor(cursor: { x: number; y: number }): {
  x: number;
  y: number;
} {
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;

  let x = cursor.x + CURSOR_OFFSET;
  if (x + OVERLAY_W > right) {
    x = cursor.x - CURSOR_OFFSET - OVERLAY_W;
  }
  let y = cursor.y + CURSOR_OFFSET;
  if (y + OVERLAY_H > bottom) {
    y = cursor.y - CURSOR_OFFSET - OVERLAY_H;
  }

  // Only now clamp, as a last resort for a cursor in a corner.
  x = Math.min(Math.max(x, workArea.x), right - OVERLAY_W);
  y = Math.min(Math.max(y, workArea.y), bottom - OVERLAY_H);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Failsafe dismissal for the picker, in case blur never arrives. */
let copyModeTimer: NodeJS.Timeout | null = null;

function clearCopyModeTimer(): void {
  if (copyModeTimer) {
    clearTimeout(copyModeTimer);
    copyModeTimer = null;
  }
}

async function showOverlayForCopy(copied: Copied): Promise<void> {
  if (!isConfigured()) {
    return;
  }
  await showOverlay();
  overlay?.webContents.send("overlay:copy-mode", copied.kind);

  // Focus lets the panel close the way any menu does: click elsewhere, or
  // press Escape.
  overlay?.setFocusable(true);
  overlay?.focus();

  clearCopyModeTimer();
  // Failsafe only; blur normally gets there first.
  copyModeTimer = setTimeout(() => {
    void acknowledgeClipboard();
    hideOverlay();
  }, 30000);
}

async function showOverlay(): Promise<void> {
  if (!isConfigured()) {
    return;
  }
  overlay ??= createOverlay();

  const cursor = screen.getCursorScreenPoint();
  const pos = overlayPositionFor(cursor);
  overlay.setBounds({ ...pos, width: OVERLAY_W, height: OVERLAY_H });
  overlay.webContents.send("overlay:show");
  overlay.showInactive();
}

function hideOverlay(): void {
  clearCopyModeTimer();
  overlay?.setFocusable(false);
  if (overlay?.isVisible()) {
    overlay.webContents.send("overlay:hide");
    overlay.hide();
  }
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) {
    return;
  }
  new Notification({ title, body, icon: iconPath(), silent: true }).show();
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 720,
    // Size the content area, not the frame, so the form never needs to scroll.
    useContentSize: true,
    title: "Karakeep Drop — Settings",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void settingsWindow.loadFile(join(__dirname, "../renderer/settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function buildTrayMenu(): Menu {
  const s = getSettings();
  return Menu.buildFromTemplate([
    {
      label: isConfigured()
        ? `Connected: ${s.serverUrl.replace(/^https?:\/\//, "")}`
        : "Not configured — open Settings",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Save what I copied  (or just left-click this icon)",
      enabled: isConfigured(),
      click: () => void saveWhatICopied(),
    },
    {
      label: "Open the collector browser",
      click: () => openBrowser(),
    },
    {
      label: "Saving a copied link",
      submenu: [
        {
          label: `On the shortcut (${s.copyHotkey})`,
          type: "radio",
          checked: s.copyMode === "hotkey",
          click: () => {
            saveSettings({ copyMode: "hotkey" });
            syncCopyMode();
            refreshTray();
          },
        },
        {
          label: "Automatically, for media copied in a browser",
          type: "radio",
          checked: s.copyMode === "auto",
          click: () => {
            saveSettings({ copyMode: "auto" });
            syncCopyMode();
            refreshTray();
          },
        },
        {
          label: "Never",
          type: "radio",
          checked: s.copyMode === "off",
          click: () => {
            saveSettings({ copyMode: "off" });
            syncCopyMode();
            refreshTray();
          },
        },
      ],
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: s.launchAtLogin,
      click: (item) => {
        saveSettings({ launchAtLogin: item.checked });
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTray();
      },
    },
    {
      label: "Open Karakeep",
      enabled: isConfigured(),
      click: () => void shell.openExternal(getSettings().serverUrl),
    },
    { label: "Settings…", click: openSettings },
    {
      label: "Open drop log…",
      click: () => {
        void (async () => {
          const err = await shell.openPath(dropLogPath());
          if (err) {
            // No handler registered for the extension, or the file is gone —
            // showing it in Explorer always works.
            shell.showItemInFolder(dropLogPath());
          }
        })();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function refreshTray(): void {
  tray?.setContextMenu(buildTrayMenu());
  tray?.setToolTip(
    isConfigured() ? "Karakeep Drop" : "Karakeep Drop — not configured",
  );
}

/**
 * The primary way in for content that can't be dragged: copy it, then click
 * the tray icon. The picker opens by the cursor — which is down at the tray,
 * so overlayPositionFor flips it up and left of the pointer.
 */
async function saveWhatICopied(): Promise<void> {
  if (!isConfigured()) {
    openSettings();
    return;
  }
  const copied = await readClipboard();
  if (!copied) {
    // Nothing to act on, so give them the menu rather than doing nothing.
    tray?.popUpContextMenu();
    return;
  }
  await showOverlayForCopy(copied);
}

/**
 * Applies the current copy-save mode: a global hotkey (nothing ever appears
 * unbidden), an automatic watcher, or neither.
 */
function syncCopyMode(): void {
  const { copyMode, copyHotkey } = getSettings();
  stopClipboardWatch();
  globalShortcut.unregisterAll();

  if (!isConfigured() || copyMode === "off") {
    return;
  }

  if (copyMode === "auto") {
    startClipboardWatch((copied) => void showOverlayForCopy(copied));
    return;
  }

  try {
    const ok = globalShortcut.register(copyHotkey, () => {
      void (async () => {
        // Explicit request, so anything saveable counts — no guessing about
        // whether the user meant it.
        const copied = await readClipboard();
        if (!copied) {
          notify(
            "Nothing to save",
            "Copy an image or a link first, then press the shortcut again.",
          );
          return;
        }
        await showOverlayForCopy(copied);
      })();
    });
    if (!ok) {
      logLine(`could not register copy hotkey "${copyHotkey}" (already taken)`);
    }
  } catch (e) {
    logLine(`bad copy hotkey "${copyHotkey}": ${String(e)}`);
  }
}

/** Keeps the most-recently-used list at the top of the picker next time. */
function rememberListUse(listId: string): void {
  const recentLists = { ...getSettings().recentLists, [listId]: Date.now() };
  // Lists get deleted and renamed; without a cap this map grows forever and
  // keeps entries for ids the server no longer knows about.
  const trimmed = Object.fromEntries(
    Object.entries(recentLists)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50),
  );
  saveSettings({ recentLists: trimmed });
}

function registerIpc(): void {
  registerBrowserIpc();
  // The browser's own menu can reach Settings without importing main, which
  // would be a cycle: main already imports the browser.
  setSettingsOpener(openSettings);

  ipcMain.handle("settings:get", (): Settings => getSettings());
  ipcMain.handle("settings:save", (_e, patch: Partial<Settings>): Settings => {
    const next = saveSettings(patch);
    refreshTray();
    syncCopyMode();
    return next;
  });
  ipcMain.handle("settings:test", () => testConnection());

  ipcMain.handle("lists:get", async (): Promise<ListNode[]> => {
    // The overlay asks on load, which happens before the first setup.
    if (!isConfigured()) {
      return [];
    }
    return buildTree(await fetchLists(), getSettings().recentLists);
  });

  ipcMain.handle(
    "clipboard:save",
    async (_e, req: ClipboardIngestRequest) => {
      clearCopyModeTimer();
      acknowledgeClipboard();
      hideOverlay();
      const result = await ingestClipboard(req);
      logLine(
        `copy-to-save -> ${result.ok ? "saved" : `FAILED: ${result.error}`}`,
      );
      if (result.ok && req.listId) {
        rememberListUse(req.listId);
      }
      if (result.ok) {
        notify(
          result.alreadyExists ? "Already saved" : "Saved to Karakeep",
          result.listName
            ? `Filed into ${result.listName}.`
            : "Bookmark created.",
        );
      } else {
        notify("Karakeep upload failed", result.error ?? "Unknown error");
      }
      return result;
    },
  );

  ipcMain.on("settings:copy", (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.on("clipboard:dismiss", () => {
    acknowledgeClipboard();
    hideOverlay();
  });

}

app.whenReady().then(() => {
  if (!isPrimaryInstance) {
    return;
  }

  // Only ever registers a login item because the user asked for one.
  app.setLoginItemSettings({ openAtLogin: getSettings().launchAtLogin });

  const icon = nativeImage.createFromPath(iconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  refreshTray();
  tray.on("click", () => void saveWhatICopied());

  // The renderers follow the Windows theme on their own via
  // prefers-color-scheme; only the tray bitmap has to be swapped by hand.
  nativeTheme.on("updated", () => {
    const next = nativeImage.createFromPath(iconPath());
    if (!next.isEmpty()) {
      tray?.setImage(next);
    }
    overlay?.setBackgroundColor(panelBackground());
  });

  registerIpc();

  overlay = createOverlay();

  syncCopyMode();

  const shot = process.argv.find((a) => a.startsWith("--shot="));
  if (process.argv.includes("--browser") || shot) {
    openBrowser(process.env.MAGPIE_URL);
    if (shot) {
      // Long enough for the page to paint; the harness owns the timing.
      setTimeout(() => {
        void (process.env.MAGPIE_DEMO_DRAG ? demoDrag() : Promise.resolve())
          .then(() => new Promise((r) => setTimeout(r, process.env.MAGPIE_DEMO_DRAG ? 1500 : 0)))
          .then(() => {
            if (process.env.MAGPIE_DEMO_DRAG === "explore") {
              return demoExplore().then(
                () => new Promise((r) => setTimeout(r, 900)),
              );
            }
            if (process.env.MAGPIE_DEMO_DRAG === "real") {
              return demoRealDrag().then(
                () => new Promise((r) => setTimeout(r, 2500)),
              );
            }
            if (process.env.MAGPIE_DEMO_DRAG === "save") {
              return demoSavePage().then(
                () => new Promise((r) => setTimeout(r, 26000)),
              );
            }
            if (process.env.MAGPIE_DEMO_DRAG === "loose") {
              return demoDropLoose().then(
                () => new Promise((r) => setTimeout(r, 4000)),
              );
            }
            return undefined;
          })
          .then(() => captureWindow(shot.slice("--shot=".length)))
          .catch((e) => console.error("[magpie] shot failed:", e))
          .finally(() => app.exit(0));
      }, Number(process.env.MAGPIE_SHOT_DELAY ?? 6000));
    }
    return;
  }

  if (!isConfigured()) {
    openSettings();
  }
});

// Relaunching should bring back the window you launched. The tray app
// outlives its windows, so a second launch is almost always someone trying to
// get the browser back after closing it — not asking for the settings dialog.
app.on("second-instance", () => {
  if (isConfigured()) {
    openBrowser();
  } else {
    openSettings();
  }
});

// Tray apps outlive their windows.
app.on("window-all-closed", () => undefined);

app.on("before-quit", () => {
  stopClipboardWatch();
  globalShortcut.unregisterAll();
});
