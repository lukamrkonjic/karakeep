import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
} from "electron";

import { getSettings, isConfigured, saveSettings } from "./config";
import { dragWatcher } from "./dragWatch";
import {
  acknowledgeClipboard,
  Copied,
  startClipboardWatch,
  stopClipboardWatch,
} from "./clipboardWatch";
import { dropLogPath, logDrop, logLine } from "./dropLog";
import { ingest, ingestClipboard } from "./ingest";
import { fetchLists, testConnection } from "./karakeep";
import { buildTree } from "../shared/listTree";
import {
  ClipboardIngestRequest,
  IngestRequest,
  ListNode,
  Settings,
} from "../shared/types";

const OVERLAY_W = 272;
const OVERLAY_H = 380;
/**
 * How far the panel sits from the cursor. Small on purpose: the point is to
 * flick the drag a centimetre and be on a list, not to cross the screen.
 */
const CURSOR_OFFSET = 10;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
/** True between a drop landing on the overlay and the drag ending. */
let dropHandled = false;

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

// A second instance would install a second global hook and fight the first
// over the overlay, so hand off to the running one instead.
if (!app.requestSingleInstanceLock()) {
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
    // Never take focus: stealing it mid-drag can cancel the drag outright.
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
  void win.loadFile(join(__dirname, "../renderer/overlay.html"));
  return win;
}

/**
 * Places the panel just off the cursor, flipping to the other side when it
 * would run off the display rather than sliding along the edge — sliding is
 * what strands it far from the cursor on a wide monitor.
 *
 * `cursor` must already be in device-independent pixels; see showOverlay.
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

/** Auto-dismiss for the copy-triggered picker; a drag has no such timer. */
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
  clearCopyModeTimer();
  // Unlike a drag, nothing else will dismiss this, so it times out on its own
  // rather than sitting over the user's screen indefinitely.
  copyModeTimer = setTimeout(() => {
    acknowledgeClipboard();
    hideOverlay();
  }, 9000);
}

async function showOverlay(): Promise<void> {
  if (!isConfigured()) {
    return;
  }
  overlay ??= createOverlay();
  dropHandled = false;

  // Deliberately not the hook's coordinates: uiohook reports physical pixels
  // while setBounds expects device-independent ones, so on this machine's
  // 150%-scaled display every position was off by half again and ended up
  // pinned to the right edge. Electron's own cursor read is already in DIP.
  const cursor = screen.getCursorScreenPoint();
  const pos = overlayPositionFor(cursor);
  overlay.setBounds({ ...pos, width: OVERLAY_W, height: OVERLAY_H });
  overlay.webContents.send("overlay:show");
  // showInactive keeps focus with the drag source.
  overlay.showInactive();
}

function hideOverlay(): void {
  clearCopyModeTimer();
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
      label: "Pop up while dragging",
      type: "checkbox",
      checked: s.overlayEnabled,
      click: (item) => {
        saveSettings({ overlayEnabled: item.checked });
        refreshTray();
      },
    },
    {
      label: "Save media copied in a browser",
      type: "checkbox",
      checked: s.copyToSave,
      click: (item) => {
        saveSettings({ copyToSave: item.checked });
        syncClipboardWatch();
        refreshTray();
      },
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

/** Starts or stops the copy watcher to match the current settings. */
function syncClipboardWatch(): void {
  if (getSettings().copyToSave && isConfigured()) {
    startClipboardWatch((copied) => void showOverlayForCopy(copied));
  } else {
    stopClipboardWatch();
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
  ipcMain.handle("settings:get", (): Settings => getSettings());
  ipcMain.handle("settings:save", (_e, patch: Partial<Settings>): Settings => {
    const next = saveSettings(patch);
    refreshTray();
    syncClipboardWatch();
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

  ipcMain.handle("drop:ingest", async (_e, req: IngestRequest) => {
    dropHandled = true;
    hideOverlay();
    const result = await ingest(req);
    logDrop(req.payload, result.ok ? "saved" : `FAILED: ${result.error}`);
    if (result.ok && req.listId) {
      rememberListUse(req.listId);
    }
    if (result.ok) {
      notify(
        result.alreadyExists ? "Already saved" : "Saved to Karakeep",
        result.alreadyExists
          ? "That one was already in your library."
          : result.listName
            ? `Filed into ${result.listName}.`
            : "Bookmark created.",
      );
    } else {
      notify("Karakeep upload failed", result.error ?? "Unknown error");
    }
    return result;
  });

  ipcMain.on("drop:diag", (_e, line: string) => {
    logLine(line);
  });

  // A drag that carried no data at all (some sites drag an empty element).
  // The drag is over by now, so taking focus is safe and lets the panel read
  // a Ctrl+V directly instead of hijacking a global shortcut.
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

  ipcMain.on("clipboard:dismiss", () => {
    acknowledgeClipboard();
    hideOverlay();
  });

  ipcMain.on("drop:empty", (_e, target: { listName: string | null }) => {
    logLine(`drop carried no data; list=${target.listName ?? "(none)"}`);
    hideOverlay();
    notify(
      "That drag carried no data",
      "The site attached nothing to the drag, so there was nothing to save.",
    );
  });

  // The renderer tells us when the pointer leaves the panel entirely, so a
  // drag that passes over it on the way elsewhere doesn't leave it stuck open.
  ipcMain.on("overlay:dismiss", () => {
    if (!dropHandled) {
      hideOverlay();
    }
  });
}

app.whenReady().then(() => {
  // Only ever registers a login item because the user asked for one.
  app.setLoginItemSettings({ openAtLogin: getSettings().launchAtLogin });

  const icon = nativeImage.createFromPath(iconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  refreshTray();
  tray.on("click", () => tray?.popUpContextMenu());

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

  dragWatcher.on("dragstart", () => {
    // A drag supersedes a copy prompt that's still on screen.
    clearCopyModeTimer();
    void showOverlay();
  });
  dragWatcher.on("dragend", () => {
    // The renderer's drop handler runs a beat after the OS mouseup, so give it
    // a moment to claim the drag before tearing the panel down.
    setTimeout(() => {
      if (!dropHandled) {
        hideOverlay();
      }
    }, 250);
  });

  syncClipboardWatch();

  try {
    dragWatcher.start();
  } catch (e) {
    notify(
      "Karakeep Drop",
      `Global drag detection unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!isConfigured()) {
    openSettings();
  }
});

app.on("second-instance", openSettings);

// Tray apps outlive their windows.
app.on("window-all-closed", () => undefined);

app.on("before-quit", () => {
  stopClipboardWatch();
  try {
    dragWatcher.stop();
  } catch {
    // Shutting down anyway.
  }
});
