import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
} from "electron";

import { getSettings, isConfigured, saveSettings } from "./config";
import { dragWatcher } from "./dragWatch";
import { ingest } from "./ingest";
import { buildTree, fetchLists, testConnection } from "./karakeep";
import { IngestRequest, ListNode, Settings } from "../shared/types";

const OVERLAY_W = 300;
const OVERLAY_H = 380;
/** Nudge the panel off the cursor so it never sits under the drag image. */
const CURSOR_OFFSET = 18;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
/** True between a drop landing on the overlay and the drag ending. */
let dropHandled = false;

const iconPath = () => join(__dirname, "../renderer/icon.png");

// A second instance would install a second global hook and fight the first
// over the overlay, so hand off to the running one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    // Never take focus: stealing it mid-drag can cancel the drag outright.
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
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

/** Keeps the panel fully on whichever monitor the cursor is on. */
function overlayPositionFor(cursor: { x: number; y: number }): {
  x: number;
  y: number;
} {
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const x = Math.min(
    Math.max(cursor.x + CURSOR_OFFSET, workArea.x),
    workArea.x + workArea.width - OVERLAY_W,
  );
  const y = Math.min(
    Math.max(cursor.y + CURSOR_OFFSET, workArea.y),
    workArea.y + workArea.height - OVERLAY_H,
  );
  return { x: Math.round(x), y: Math.round(y) };
}

async function showOverlay(cursor: { x: number; y: number }): Promise<void> {
  if (!isConfigured()) {
    return;
  }
  overlay ??= createOverlay();
  dropHandled = false;

  const pos = overlayPositionFor(cursor);
  overlay.setBounds({ ...pos, width: OVERLAY_W, height: OVERLAY_H });
  overlay.webContents.send("overlay:show");
  // showInactive keeps focus with the drag source.
  overlay.showInactive();
}

function hideOverlay(): void {
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
    height: 620,
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

function registerIpc(): void {
  ipcMain.handle("settings:get", (): Settings => getSettings());
  ipcMain.handle("settings:save", (_e, patch: Partial<Settings>): Settings => {
    const next = saveSettings(patch);
    refreshTray();
    return next;
  });
  ipcMain.handle("settings:test", () => testConnection());

  ipcMain.handle("lists:get", async (): Promise<ListNode[]> => {
    // The overlay asks on load, which happens before the first setup.
    if (!isConfigured()) {
      return [];
    }
    return buildTree(await fetchLists());
  });

  ipcMain.handle("drop:ingest", async (_e, req: IngestRequest) => {
    dropHandled = true;
    hideOverlay();
    const result = await ingest(req);
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

  registerIpc();

  overlay = createOverlay();

  dragWatcher.on("dragstart", (pos) => void showOverlay(pos));
  dragWatcher.on("dragend", () => {
    // The renderer's drop handler runs a beat after the OS mouseup, so give it
    // a moment to claim the drag before tearing the panel down.
    setTimeout(() => {
      if (!dropHandled) {
        hideOverlay();
      }
    }, 250);
  });

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
  try {
    dragWatcher.stop();
  } catch {
    // Shutting down anyway.
  }
});
