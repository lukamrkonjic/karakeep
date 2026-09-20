import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeTheme,
  session,
  shell,
  WebContents,
  WebContentsView,
} from "electron";

import { enableAdblock, isAdblockOn, setAdblockEnabled } from "./adblock";
import { capturePage, registerCaptureBridge } from "./archive";
import { getSettings, isConfigured, saveSettings } from "./config";
import { logLine } from "./dropLog";
import { FetchImpl, saveSource } from "./ingest";
import {
  addTags,
  createTextBookmark,
  deleteBookmark,
  ExistingBookmark,
  fetchLists,
  findExistingByUrl,
  uploadSinglefileArchive,
} from "./karakeep";
import { buildTree } from "../shared/listTree";
import {
  BrowserState,
  DragPayload,
  DropPanelState,
  DropTarget,
  KarakeepList,
  ListNode,
  PickerList,
  PickerNode,
  StatusState,
  TabState,
} from "../shared/types";

/**
 * Tab strip plus toolbar, and nothing else: there is no system title bar, and
 * saved pages ride in the tab strip rather than on a row of their own.
 */
const CHROME_BASE_H = 80;
/**
 * Breathing room around the page. The chrome shows through it, so the content
 * reads as a card sitting on the browser rather than as the browser itself.
 */
const GUTTER = 9;
/** Matches the gutter, so the page looks inset rather than clipped. */
const CONTENT_RADIUS = 10;
/** The status bar at rest, and grown to hold a tag field after a save. */
const STATUS_H = 30;
const STATUS_H_TALL = 72;
/** How long a finished save stays offering a tag field and Undo. */
const STATUS_HOLD_MS = 9000;

/**
 * Its own persistent partition, so logins here survive a restart — which they
 * have to, because being logged in is the only reason this browser archives
 * better than the server's crawler does.
 */
const PARTITION = "persist:magpie";

/*
 * A new tab is blank. This is a browser you come to with something in mind —
 * a board to open, a page to keep — so a search engine's front page is a
 * thing to dismiss rather than a place to start. The address bar takes a
 * search just the same.
 */
const HOME = "about:blank";

interface Tab {
  id: number;
  view: WebContentsView;
}

let win: BrowserWindow | null = null;
const tabs: Tab[] = [];
let activeId: number | null = null;
let nextId = 1;
let statusTimer: NodeJS.Timeout | null = null;

let status: StatusState = { kind: "idle", message: "", expanded: false };

function chromeBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#191919" : "#ffffff";
}

function chromeHeight(): number {
  return CHROME_BASE_H;
}

function tabOf(id: number | null): Tab | undefined {
  return tabs.find((t) => t.id === id);
}

function activeContents(): WebContents | null {
  return tabOf(activeId)?.view.webContents ?? null;
}

/* ---------------- layout ---------------- */

/**
 * The chrome is one ordinary page filling the window, and the tab views are
 * inset over its middle. That leaves the top strip and the bottom bar showing
 * through from the same renderer, so the status bar needs no second window
 * and no transparency trick.
 */
function layout(): void {
  if (!win || win.isDestroyed()) {
    return;
  }
  const [w = 0, h = 0] = win.getContentSize();
  const statusH = status.expanded ? STATUS_H_TALL : STATUS_H;
  const top = chromeHeight();
  const pageH = Math.max(0, h - top - statusH - GUTTER);
  for (const t of tabs) {
    const active = t.id === activeId;
    t.view.setVisible(active);
    if (active) {
      t.view.setBounds({
        x: GUTTER,
        y: top,
        width: Math.max(0, w - GUTTER * 2),
        height: pageH,
      });
    }
  }
}

function tabState(t: Tab): TabState {
  const wc = t.view.webContents;
  return {
    id: t.id,
    title: wc.getTitle() || "New tab",
    url: wc.getURL(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };
}

function pushState(): void {
  if (!win || win.isDestroyed()) {
    return;
  }
  const s = getSettings();
  const state: BrowserState = {
    tabs: tabs.map(tabState),
    activeId,
    bookmarks: s.bookmarks,
    homeUrl: s.homeUrl,
    maximized: win.isMaximized(),
  };
  win.webContents.send("magpie:state", state);
}

function setStatus(next: StatusState, holdMs = 0): void {
  const wasExpanded = status.expanded;
  status = next;
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (holdMs > 0) {
    statusTimer = setTimeout(() => {
      setStatus({ kind: "idle", message: "", expanded: false });
    }, holdMs);
  }
  if (wasExpanded !== status.expanded) {
    layout();
  }
  win?.webContents.send("magpie:status", status);
}

/* ---------------- URLs ---------------- */

/** Address bar text to a URL: a search unless it looks like somewhere to go. */
export function toUrl(text: string): string {
  const t = text.trim();
  if (!t) {
    return HOME;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    return t;
  }
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([/?#]|$)/i.test(t)) {
    return "http://" + t;
  }
  // A bare domain, but only with no space in it: "apple pie .com" is a search
  // and "apple.com/pie" is not.
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(t)) {
    return "https://" + t;
  }
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

/* ---------------- saving ---------------- */

/** The latest favicon URL each tab has announced. */
const favicons = new Map<number, string | null>();

/** How big a favicon is allowed to be before it is not worth inlining. */
const MAX_ICON_BYTES = 200 * 1024;

/**
 * Fetches a tab's favicon and returns it as a data: URL.
 *
 * It is inlined rather than linked so the toolbar draws with no network, keeps
 * working when the site is down, and needs no loosening of the chrome's
 * content security policy.
 */
async function faviconDataUrl(
  wc: WebContents,
  tabId: number,
): Promise<string> {
  const candidates = [favicons.get(tabId)];
  try {
    candidates.push(new URL("/favicon.ico", wc.getURL()).toString());
  } catch {
    // Not a URL we can build a fallback from.
  }

  for (const url of candidates) {
    if (!url || !/^https?:/i.test(url)) {
      continue;
    }
    try {
      const res = await wc.session.fetch(url, { credentials: "include" });
      if (!res.ok) {
        continue;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_ICON_BYTES) {
        continue;
      }
      const type = res.headers.get("content-type")?.split(";")[0]?.trim();
      if (!type?.startsWith("image/")) {
        continue;
      }
      return `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

/** Puts a page on the toolbar, newest first, without duplicating it. */
async function rememberBookmark(
  wc: WebContents,
  tabId: number,
  title: string,
): Promise<void> {
  const url = wc.getURL();
  if (!/^https?:/i.test(url)) {
    return;
  }
  const icon = await faviconDataUrl(wc, tabId);
  const kept = getSettings().bookmarks.filter((b) => b.url !== url);
  saveSettings({
    bookmarks: [{ url, title: title || url, icon }, ...kept].slice(0, 24),
  });
  // The bar may have just appeared, which changes how much room the page has.
  layout();
  pushState();
}



/** A fetch bound to a tab's session, so its cookies and proxy apply. */
function sessionFetchFor(wc: WebContents): FetchImpl {
  return (url, init) =>
    wc.session.fetch(url, {
      ...init,
      credentials: "include",
    }) as Promise<Response>;
}

/* ---------------- duplicates ---------------- */

type DuplicateAnswer = "save" | "update" | "open" | "cancel";

/**
 * Asks what to do about something already in Karakeep.
 *
 * A failed lookup answers "save": a check that cannot reach the server is no
 * reason to refuse to keep something.
 */
async function checkDuplicate(
  url: string,
  kind: "page" | "image",
): Promise<DuplicateAnswer> {
  let existing: ExistingBookmark | null = null;
  try {
    existing = await findExistingByUrl(url);
  } catch {
    return "save";
  }
  if (!existing || !win || win.isDestroyed()) {
    return "save";
  }

  const known = existing.title ? `"${existing.title}"` : "It";
  const buttons =
    kind === "page"
      ? ["Update the archive", "Keep both versions", "Open the one I have", "Cancel"]
      : ["Save a duplicate", "Open the one I have", "Cancel"];

  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    // The default is the harmless one, so a stray Return never duplicates.
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
    message:
      kind === "page"
        ? "You have already saved this page."
        : "You have already saved this image.",
    detail:
      kind === "page"
        ? `${known} is already in Karakeep. Updating replaces its archive with what you are looking at now; keeping both versions files this one alongside it.`
        : `${known} is already in Karakeep.`,
  });

  if (kind === "page") {
    return (["update", "save", "open", "cancel"] as const)[response] ?? "cancel";
  }
  return (["save", "open", "cancel"] as const)[response] ?? "cancel";
}

function openExisting(url: string): void {
  void findExistingByUrl(url)
    .then((existing) => {
      const { serverUrl } = getSettings();
      if (existing && serverUrl) {
        void shell.openExternal(
          serverUrl + "/dashboard/preview/" + existing.id,
        );
      }
    })
    .catch(() => undefined);
  setStatus({ kind: "idle", message: "", expanded: false });
}

function guard(): boolean {
  if (isConfigured()) {
    return true;
  }
  setStatus(
    {
      kind: "error",
      message: "Not connected to Karakeep",
      detail: "Add your server URL and an API key in Settings.",
      expanded: true,
    },
    STATUS_HOLD_MS,
  );
  return false;
}

function failed(what: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  logLine("browser " + what + " -> FAILED: " + msg);
  setStatus(
    { kind: "error", message: "Could not save", detail: msg, expanded: true },
    STATUS_HOLD_MS,
  );
}

/**
 * Archives the page as it stands in front of you. The save is committed
 * before the bar offers tagging — nothing here ever blocks on a form.
 */
async function savePage(): Promise<void> {
  const wc = activeContents();
  if (!wc || !guard()) {
    return;
  }
  const answer = await checkDuplicate(wc.getURL(), "page");
  if (answer === "cancel") {
    setStatus({ kind: "idle", message: "", expanded: false });
    return;
  }
  if (answer === "open") {
    openExisting(wc.getURL());
    return;
  }

  setStatus({ kind: "working", message: "Archiving page...", expanded: false });
  try {
    const shot = await capturePage(wc);
    const bookmark = await uploadSinglefileArchive({
      html: shot.html,
      url: shot.url,
      // "Keep both versions" attaches this archive alongside the one already
      // there rather than replacing it.
      ifExists: answer === "save" ? "append" : "overwrite",
    });
    const kb = Math.round(shot.html.length / 1024);
    logLine("browser archive " + shot.url + " -> " + bookmark.id + " (" + kb + " KB)");

    // A page worth archiving is a page worth getting back to, so it goes on
    // the toolbar at the same time.
    const tabId = tabs.find((t) => t.view.webContents === wc)?.id;
    if (tabId !== undefined) {
      await rememberBookmark(wc, tabId, shot.title);
    }
    setStatus(
      {
        kind: "saved",
        message: bookmark.alreadyExists ? "Archive updated" : "Saved",
        detail: shot.title + " · " + kb + " KB",
        bookmarkId: bookmark.id,
        expanded: true,
      },
      STATUS_HOLD_MS,
    );
  } catch (e) {
    failed("archive", e);
  }
}

/** Saves media by URL, fetched through the tab that is showing it. */
async function saveMedia(
  wc: WebContents,
  url: string,
  label: string,
): Promise<void> {
  if (!guard()) {
    return;
  }
  if (label === "image" || label === "video") {
    const answer = await checkDuplicate(url, "image");
    if (answer === "cancel") {
      setStatus({ kind: "idle", message: "", expanded: false });
      return;
    }
    if (answer === "open") {
      openExisting(url);
      return;
    }
  }

  setStatus({
    kind: "working",
    message: "Saving " + label + "...",
    expanded: false,
  });
  try {
    const result = await saveSource(
      { url, bytes: null, title: null },
      { listId: null, listName: null },
      { fetchImpl: sessionFetchFor(wc), referer: wc.getURL() },
    );
    if (!result.ok) {
      throw new Error(result.error ?? "Unknown error");
    }
    logLine("browser " + label + " " + url + " -> " + result.bookmarkId);
    setStatus(
      {
        kind: "saved",
        message: result.alreadyExists ? "Already saved" : "Saved",
        detail: label,
        bookmarkId: result.bookmarkId,
        expanded: true,
      },
      STATUS_HOLD_MS,
    );
  } catch (e) {
    failed(label, e);
  }
}

async function saveSelection(wc: WebContents, text: string): Promise<void> {
  if (!guard()) {
    return;
  }
  setStatus({
    kind: "working",
    message: "Saving selection...",
    expanded: false,
  });
  try {
    const bookmark = await createTextBookmark(text, wc.getURL(), wc.getTitle());
    logLine("browser selection -> " + bookmark.id);
    setStatus(
      {
        kind: "saved",
        message: "Selection saved",
        detail: text.length > 70 ? text.slice(0, 70) + "…" : text,
        bookmarkId: bookmark.id,
        expanded: true,
      },
      STATUS_HOLD_MS,
    );
  } catch (e) {
    failed("selection", e);
  }
}

/* ---------------- tabs ---------------- */

function openTab(url: string, opts?: { background?: boolean }): Tab {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, "../preload/capturePreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // The page is a card on the browser, not the browser itself.
  view.setBorderRadius(CONTENT_RADIUS);

  const tab: Tab = { id: nextId++, view };
  tabs.push(tab);
  favicons.set(tab.id, null);
  win?.contentView.addChildView(view);

  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: target }) => {
    // Target-blank links become tabs rather than stray popup windows, which
    // would sit outside the chrome and outside the save shortcuts.
    if (/^https?:/i.test(target)) {
      openTab(target, { background: true });
    }
    return { action: "deny" };
  });

  // Listed one by one rather than looped: the overloads for these are all
  // distinct, so a union of names matches none of them.
  const bump = (): void => pushState();
  wc.on("page-favicon-updated", (_e, urls) => {
    // Last is usually the largest, and any of them beats guessing.
    favicons.set(tab.id, urls.at(-1) ?? null);
  });
  wc.on("page-title-updated", bump);
  wc.on("did-start-loading", bump);
  wc.on("did-stop-loading", bump);
  wc.on("did-navigate", bump);
  wc.on("did-navigate-in-page", bump);
  wc.on("did-fail-load", bump);

  // Pinterest and friends also disable dragging in CSS, which no attribute
  // flip in the preload can undo. insertCSS lands outside the page's own
  // stylesheets, so this survives the site rewriting its own styles, and it
  // is re-applied per document because a navigation clears it.
  wc.on("dom-ready", () => {
    void wc
      .insertCSS("img, picture, a img { -webkit-user-drag: element !important; }")
      .catch(() => {
        // A page that refuses the stylesheet still drags via the attribute.
      });
  });

  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();

    // Caught here rather than in an application menu so it wins against a
    // page that binds Ctrl+S for itself.
    if (ctrl && key === "s") {
      e.preventDefault();
      void savePage();
    } else if (ctrl && key === "t") {
      e.preventDefault();
      selectTab(openTab(HOME).id);
    } else if (ctrl && key === "w") {
      e.preventDefault();
      closeTab(tab.id);
    } else if (ctrl && key === "l") {
      e.preventDefault();
      win?.webContents.send("magpie:focus-omnibox");
    } else if (key === "f5" || (ctrl && key === "r")) {
      e.preventDefault();
      wc.reload();
    } else if (input.alt && key === "arrowleft") {
      e.preventDefault();
      if (wc.navigationHistory.canGoBack()) {
        wc.navigationHistory.goBack();
      }
    } else if (input.alt && key === "arrowright") {
      e.preventDefault();
      if (wc.navigationHistory.canGoForward()) {
        wc.navigationHistory.goForward();
      }
    }
  });

  wc.on("context-menu", (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    const selection = p.selectionText?.trim();

    if (p.mediaType === "image" && p.srcURL) {
      items.push({
        label: "Save image to Karakeep",
        click: () => void saveMedia(wc, p.srcURL, "image"),
      });
    }
    if (p.mediaType === "video" && p.srcURL) {
      items.push({
        label: "Save video to Karakeep",
        click: () => void saveMedia(wc, p.srcURL, "video"),
      });
    }
    if (p.linkURL) {
      items.push({
        label: "Save link to Karakeep",
        click: () => void saveMedia(wc, p.linkURL, "link"),
      });
    }
    if (selection) {
      items.push({
        label: "Save selection to Karakeep",
        click: () => void saveSelection(wc, selection),
      });
    }
    items.push({
      label: "Archive this page to Karakeep",
      accelerator: "Ctrl+S",
      click: () => void savePage(),
    });

    items.push({ type: "separator" });
    if (p.linkURL) {
      items.push(
        {
          label: "Open link in new tab",
          click: () => openTab(p.linkURL, { background: true }),
        },
        {
          label: "Copy link address",
          click: () => clipboard.writeText(p.linkURL),
        },
      );
    }
    if (p.srcURL) {
      items.push({
        label: "Copy image address",
        click: () => clipboard.writeText(p.srcURL),
      });
    }
    if (selection) {
      items.push({ label: "Copy", role: "copy" });
    }
    if (p.isEditable) {
      items.push({ label: "Paste", role: "paste" });
    }
    items.push(
      { type: "separator" },
      {
        label: "Back",
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack(),
      },
      { label: "Reload", click: () => wc.reload() },
    );

    Menu.buildFromTemplate(items).popup({ window: win ?? undefined });
  });

  void wc.loadURL(url);

  if (!opts?.background || activeId === null) {
    activeId = tab.id;
    if (url === HOME) {
      win?.webContents.send("magpie:focus-omnibox");
    }
  }
  layout();
  pushState();
  return tab;
}

function selectTab(id: number): void {
  if (!tabOf(id)) {
    return;
  }
  activeId = id;
  layout();
  pushState();
  activeContents()?.focus();
}

function closeTab(id: number): void {
  const i = tabs.findIndex((t) => t.id === id);
  if (i === -1) {
    return;
  }
  const [tab] = tabs.splice(i, 1);
  favicons.delete(id);
  if (tab) {
    win?.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }
  }

  if (activeId === id) {
    activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
  }
  if (tabs.length === 0) {
    win?.close();
    return;
  }
  layout();
  pushState();
}

/* ---------------- window ---------------- */

export function openBrowser(url?: string): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    if (url) {
      selectTab(openTab(url).id);
    }
    return;
  }

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 620,
    minHeight: 420,
    // No system title bar: the tab strip is the title bar, dragged by the
    // empty space in it. Windows 11 rounds a frameless window on its own, so
    // nothing here has to draw the corners.
    frame: false,
    roundedCorners: true,
    backgroundColor: chromeBackground(),
    title: "Magpie",
    webPreferences: {
      preload: join(__dirname, "../preload/browserPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(join(__dirname, "../renderer/browser.html"));

  win.on("resize", () => {
    layout();
    if (dropView?.getVisible()) {
      positionDropView(dropView);
    }
  });
  win.on("closed", () => {
    for (const t of tabs.splice(0)) {
      if (!t.view.webContents.isDestroyed()) {
        t.view.webContents.close();
      }
    }
    activeId = null;
    dropView = null;
    dropReady = null;
    pendingDrag = null;
    dragSource = null;
    win = null;
  });

  // Warmed now rather than on the first drag, so the panel has something to
  // draw the instant it is asked for.
  void pickerData().catch(() => undefined);

  // The panel is built up front too: creating it costs a page load, which is
  // far too slow to do while someone is already dragging.
  ensureDropView();

  const sess = session.fromPartition(PARTITION);

  // Electron's default user agent announces itself, and sites that dislike
  // embedded browsers use that to refuse a sign-in or drop the session early.
  // Stripping the Electron and app tokens leaves an ordinary Chrome string,
  // which is the difference between a login that sticks and one that does not.
  sess.setUserAgent(
    sess.getUserAgent().replace(/ (?:Electron|Karakeep Drop|Magpie)\/[^ ]+/g, ""),
  );

  // Blocking is per-session and the first load has to fetch the lists, so it
  // is kicked off with the window rather than at app start.
  if (getSettings().adblockEnabled) {
    void enableAdblock(sess);
  }

  // Listed one by one rather than looped: their overloads are all distinct,
  // so a union of names matches none of them.
  const reframed = (): void => {
    layout();
    pushState();
  };
  win.on("maximize", reframed);
  win.on("unmaximize", reframed);
  win.on("enter-full-screen", reframed);
  win.on("leave-full-screen", reframed);

  win.webContents.once("did-finish-load", () => {
    selectTab(openTab(url ?? getSettings().homeUrl ?? HOME).id);
    win?.webContents.send("magpie:status", status);
  });
}

/**
 * Fires a real dragstart on the biggest image in the active tab, so the drop
 * panel can be reviewed from a script. The preload listens on window in the
 * capture phase, and a dispatched event reaches an isolated world the same as
 * a genuine one, so this exercises the actual path rather than a stub.
 */
export async function demoDrag(): Promise<string | null> {
  const wc = activeContents();
  if (!wc) {
    return null;
  }
  return (await wc.executeJavaScript(
    `(() => {
       const img = [...document.images]
         .filter((i) => i.naturalWidth > 120 && i.currentSrc)
         .sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
       if (!img) return null;
       img.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
       return img.currentSrc;
     })()`,
  )) as string | null;
}

/**
 * Clicks the panel's "Choose a list" row, so the explorer can be reviewed
 * from a script too. It goes through the panel's own handler rather than
 * calling into main directly, so the real path is what gets exercised.
 */
export async function demoExplore(): Promise<void> {
  if (!dropView || dropView.webContents.isDestroyed()) {
    return;
  }
  await dropView.webContents.executeJavaScript(
    `document.getElementById("zone-choose").click()`,
  );
  // Dropping on "Choose a list" ends the drag, so the page's dragend lands
  // just after. Replaying it here is the whole point: without it the harness
  // could never catch the close it used to schedule.
  await new Promise((r) => setTimeout(r, 120));
  ipcMain.emit("magpie:drag-end");
}

/**
 * Synthesises a real drag on a visible image and leaves the button down, so
 * the panel can be reviewed in the state it is actually used in. A dispatched
 * DragEvent will not do: only real input makes Chromium decide a drag may
 * begin, which is the whole question on a site that fights it.
 */
export async function demoRealDrag(): Promise<unknown> {
  const wc = activeContents();
  if (!wc) {
    return null;
  }
  const spot = (await wc.executeJavaScript(
    `(() => {
       const vw = innerWidth, vh = innerHeight;
       const imgs = [...document.images].filter((i) => {
         if (!i.currentSrc) return false;
         const b = i.getBoundingClientRect();
         return b.width > 120 && b.height > 120 &&
                b.top > 8 && b.left > 8 && b.bottom < vh - 8 && b.right < vw - 8;
       });
       if (!imgs.length) return null;
       const area = (i) => { const b = i.getBoundingClientRect(); return b.width * b.height; };
       const img = imgs.sort((a, b) => area(b) - area(a))[0];
       const r = img.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`,
  )) as { x: number; y: number } | null;
  if (!spot) {
    return null;
  }

  wc.sendInputEvent({
    type: "mouseDown",
    x: spot.x,
    y: spot.y,
    button: "left",
    clickCount: 1,
  });
  for (let i = 1; i <= 16; i++) {
    wc.sendInputEvent({
      type: "mouseMove",
      x: spot.x + i * 14,
      y: spot.y + i * 7,
      button: "left",
    });
    await new Promise((r) => setTimeout(r, 40));
  }
  // Deliberately no mouseUp: the drag is left in flight.
  return spot;
}

/** Presses Save page from a script, for reviewing the bookmarks bar. */
export async function demoSavePage(): Promise<void> {
  if (!win || win.isDestroyed()) {
    return;
  }
  await win.webContents.executeJavaScript(
    'document.getElementById("save").click()',
  );
}

/** Clicks the loose half, so the unsorted path can be run from a script. */
export async function demoDropLoose(): Promise<void> {
  if (!dropView || dropView.webContents.isDestroyed()) {
    return;
  }
  await dropView.webContents.executeJavaScript(
    `document.getElementById("zone-unsorted").click()`,
  );
}

/** capturePage fails while the compositor is still coming up, so retry. */
async function shoot(wc: WebContents): Promise<Buffer> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return (await wc.capturePage()).toPNG();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw last;
}

/**
 * Writes the browser to PNGs, so the chrome can be looked at without a hand
 * on the mouse.
 *
 * Two files, because capturePage only exists on WebContents and the chrome's
 * contents never contain the tab views stacked over them — the middle of a
 * chrome capture is always the empty region the views cover.
 */
export async function captureWindow(file: string): Promise<void> {
  if (!win || win.isDestroyed()) {
    throw new Error("No browser window open");
  }
  win.show();
  const stem = file.replace(/\.png$/i, "");

  // Each surface is attempted on its own. They come and go independently, and
  // losing every capture because one of them was not ready to be read makes
  // the harness useless exactly when there is something to look at.
  const surfaces: [string, WebContents | null][] = [
    [file, win.webContents],
    [stem + "-page.png", activeContents()],
    [
      stem + "-drop.png",
      dropView?.getVisible() && !dropView.webContents.isDestroyed()
        ? dropView.webContents
        : null,
    ],
  ];

  for (const [path, wc] of surfaces) {
    if (!wc) {
      continue;
    }
    try {
      await writeFile(path, await shoot(wc));
      console.log("[magpie] shot:", path);
    } catch (e) {
      console.error(
        "[magpie] could not capture",
        path,
        e instanceof Error ? e.message : e,
      );
    }
  }
}


/* ---------------- drag to file ---------------- */

/*
 * The Eagle interaction: pick an image up and a panel appears offering the
 * lists you actually use, a loose "just keep it" half, and a search.
 *
 * The tray app could not do this. Its README settled for copy-to-save because
 * sites like Pinterest attach nothing to a drag, so no drop target could
 * recover the image. That is irrelevant from inside our own tabs: the preload
 * reads the <img> out of the DOM at dragstart, and the drag's own payload is
 * never touched.
 */

/** Matches the card's exit transition in the stylesheet. */
const LEAVE_MS = 190;
/** Lists are re-read this often, so a burst of drags costs one request. */
const LIST_TTL_MS = 30_000;
/** How many recently used lists the filing view offers. */
const RECENT_SHOWN = 7;

let dropView: WebContentsView | null = null;
let dropReady: Promise<void> | null = null;
let pendingDrag: DragPayload | null = null;
let dragSource: WebContents | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let vanishTimer: NodeJS.Timeout | null = null;
/**
 * Set once the panel has become the explorer, which pins it open.
 *
 * Dropping on "Choose a list" ends the drag, so `dragend` arrives on the page
 * a moment *after* the drop arrived on the panel — and it would schedule the
 * very close the drop had just cancelled. From here on the panel is a modal:
 * it goes when a list is picked, when you click away, or on Escape.
 */
let exploring = false;

let listCache: {
  at: number;
  all: PickerList[];
  tree: PickerNode[];
} | null = null;

/** Flattens the list tree, keeping each list's ancestry for display. */
function flatten(lists: KarakeepList[]): PickerList[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const pathOf = (l: KarakeepList): string => {
    const parts: string[] = [];
    let parent = l.parentId ? byId.get(l.parentId) : undefined;
    // Bounded, so a cycle in the data cannot hang the panel.
    for (let i = 0; parent && i < 8; i++) {
      parts.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  return lists
    .filter((l) => l.type === "manual")
    .map((l) => ({ id: l.id, name: l.name, path: pathOf(l) }));
}

/**
 * A list icon is an emoji, so a purely ASCII one is mangled data rather than
 * a picture — several on this server are stored as a literal "??", which is
 * what an emoji looks like after a trip through a non-UTF-8 encoding. Drawing
 * those adds noise to every row, so they are treated as no icon at all.
 */
function realIcon(icon: string): string {
  // eslint-disable-next-line no-control-regex
  return /[^ -]/.test(icon) ? icon : "";
}

/** ListNode carries more than the panel needs; this is the part it draws. */
function toPickerNodes(nodes: ListNode[]): PickerNode[] {
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    icon: realIcon(n.icon),
    children: toPickerNodes(n.children),
  }));
}

async function pickerData(): Promise<{
  all: PickerList[];
  tree: PickerNode[];
}> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) {
    return listCache;
  }
  const lists = await fetchLists();
  // buildTree is the same ordering the tray picker and the web sidebar use,
  // so a folder is in the same place wherever you meet it.
  const data = {
    at: Date.now(),
    all: flatten(lists),
    tree: toPickerNodes(buildTree(lists, getSettings().recentLists)),
  };
  listCache = data;
  return data;
}

function recentFirst(all: PickerList[]): PickerList[] {
  const used = getSettings().recentLists;
  return all
    .filter((l) => used[l.id])
    .sort((a, b) => (used[b.id] ?? 0) - (used[a.id] ?? 0))
    .slice(0, RECENT_SHOWN);
}

function rememberList(id: string): void {
  saveSettings({
    recentLists: { ...getSettings().recentLists, [id]: Date.now() },
  });
}

function ensureDropView(): WebContentsView {
  if (dropView && !dropView.webContents.isDestroyed()) {
    return dropView;
  }
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, "../preload/dropzonePreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The page paints its own scrim and card, so the view itself must not
      // paint a rectangle behind them.
      transparent: true,
    },
  });
  // Belt and braces: webPreferences.transparent covers the renderer, this
  // covers the view's own fill before the first frame arrives.
  view.setBackgroundColor("#00000000");
  dropView = view;
  dropReady = new Promise((resolve) => {
    view.webContents.once("did-finish-load", () => resolve());
  });
  void view.webContents.loadFile(join(__dirname, "../renderer/dropzone.html"));
  return view;
}

/**
 * The view fills everything below the chrome and is transparent, so the card
 * inside it can fade and scale over the page. Sizing the view to the card
 * instead would make any animation a jump between two rectangles, and would
 * leave no room for the scrim that tells you the page is not the target.
 */
function positionDropView(view: WebContentsView): void {
  if (!win) {
    return;
  }
  const [w = 0, h = 0] = win.getContentSize();
  view.setBounds({
    x: 0,
    y: chromeHeight(),
    width: w,
    height: Math.max(0, h - chromeHeight()),
  });
}

function hideDropPanel(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  // Cleared at once, so a drop that arrives during the fade files nothing.
  pendingDrag = null;
  dragSource = null;
  exploring = false;

  if (!dropView || dropView.webContents.isDestroyed()) {
    return;
  }
  const view = dropView;
  view.webContents.send("magpie:drop-hide");
  if (vanishTimer) {
    clearTimeout(vanishTimer);
  }
  // Long enough for the card to fade out; the view is only actually taken
  // away once there is nothing left to see.
  vanishTimer = setTimeout(() => {
    vanishTimer = null;
    if (!pendingDrag) {
      view.setVisible(false);
    }
  }, LEAVE_MS);
}

async function showDropPanel(
  payload: DragPayload,
  source: WebContents,
): Promise<void> {
  if (!win || win.isDestroyed() || !isConfigured()) {
    return;
  }
  pendingDrag = payload;
  dragSource = source;
  exploring = false;

  const view = ensureDropView();
  // Re-parented every time so it sits above any tab opened since it was made;
  // addChildView appends to the top of the stack.
  win.contentView.removeChildView(view);
  win.contentView.addChildView(view);
  positionDropView(view);
  if (vanishTimer) {
    clearTimeout(vanishTimer);
    vanishTimer = null;
  }
  view.setVisible(true);

  await dropReady;
  if (pendingDrag !== payload) {
    return;
  }

  // Drawn at once from whatever is already known, because a drag can be over
  // in well under a second and a panel that waits for the server to answer is
  // a panel you never see. Fresh lists arrive in a second message.
  const cached = listCache;
  view.webContents.send("magpie:drop-show", {
    payload,
    recent: recentFirst(cached?.all ?? []),
    all: cached?.all ?? [],
    tree: cached?.tree ?? [],
  } satisfies DropPanelState);

  let all: PickerList[] = [];
  let tree: PickerNode[] = [];
  try {
    ({ all, tree } = await pickerData());
  } catch {
    // An unreachable server should still leave the loose half usable.
    return;
  }
  if (pendingDrag !== payload || view.webContents.isDestroyed()) {
    return;
  }
  if (cached?.all !== all) {
    view.webContents.send("magpie:drop-lists", {
      recent: recentFirst(all),
      all,
      tree,
    });
  }
}

async function fileDrop(target: DropTarget): Promise<void> {
  const payload = pendingDrag;
  const source = dragSource;
  if (!payload || !source || source.isDestroyed()) {
    hideDropPanel();
    return;
  }
  hideDropPanel();

  const answer = await checkDuplicate(payload.src, "image");
  if (answer === "cancel") {
    setStatus({ kind: "idle", message: "", expanded: false });
    return;
  }
  if (answer === "open") {
    openExisting(payload.src);
    return;
  }

  const where = target.kind === "list" ? target.name : "Karakeep";
  setStatus({
    kind: "working",
    message: "Saving to " + where + "...",
    expanded: false,
  });

  try {
    const result = await saveSource(
      { url: payload.src, bytes: null, title: payload.title },
      target.kind === "list"
        ? { listId: target.id, listName: target.name }
        : { listId: null, listName: null },
      { fetchImpl: sessionFetchFor(source), referer: payload.pageUrl },
    );
    if (!result.ok) {
      throw new Error(result.error ?? "Unknown error");
    }
    if (target.kind === "list") {
      rememberList(target.id);
    }
    logLine("browser drop " + payload.src + " -> " + result.bookmarkId);
    setStatus(
      {
        kind: "saved",
        message: result.alreadyExists ? "Already saved" : "Saved",
        detail: result.listName ? "Filed into " + result.listName : "No list",
        bookmarkId: result.bookmarkId,
        expanded: true,
      },
      STATUS_HOLD_MS,
    );
  } catch (e) {
    failed("drop", e);
  }
}

/**
 * Turning blocking on the first time in a session has to fetch the lists
 * before it can block anything, and blocking is decided as requests are made
 * — so the page in front of you does not change until it is fetched again.
 */
async function toggleAdblock(): Promise<void> {
  const sess = session.fromPartition(PARTITION);
  const want = !getSettings().adblockEnabled;
  if (want) {
    await enableAdblock(sess);
  }
  saveSettings({ adblockEnabled: setAdblockEnabled(sess, want) });
  activeContents()?.reload();
}

/**
 * Handed in by main, because importing it the other way would be a cycle.
 */
let openSettingsWindow: (() => void) | null = null;

export function setSettingsOpener(open: () => void): void {
  openSettingsWindow = open;
}

/* ---------------- ipc ---------------- */


export function registerBrowserIpc(): void {
  registerCaptureBridge();

  ipcMain.on("magpie:navigate", (_e, text: string) => {
    void activeContents()?.loadURL(toUrl(text));
  });
  ipcMain.on("magpie:new-tab", () => selectTab(openTab(HOME).id));
  ipcMain.on("magpie:select-tab", (_e, id: number) => selectTab(id));
  ipcMain.on("magpie:close-tab", (_e, id: number) => closeTab(id));
  ipcMain.on("magpie:back", () => {
    const wc = activeContents();
    if (wc?.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
  });
  ipcMain.on("magpie:forward", () => {
    const wc = activeContents();
    if (wc?.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
  });
  ipcMain.on("magpie:reload", () => activeContents()?.reload());
  ipcMain.on("magpie:save-page", () => void savePage());

  ipcMain.on("magpie:drag-start", (e, payload: DragPayload) => {
    void showDropPanel(payload, e.sender);
  });
  ipcMain.on("magpie:drag-end", () => {
    // The explorer outlives the drag that opened it.
    if (exploring) {
      return;
    }
    // Otherwise: dragend and a drop on the panel arrive in either order, so
    // the close is deferred far enough for a drop to cancel it and short
    // enough that a cancelled drag does not leave the panel hanging.
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(hideDropPanel, 260);
  });
  ipcMain.on("magpie:drop", (_e, target: DropTarget) => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    // "choose" is not a destination; it hands the panel over to the explorer,
    // which only works once the drag has ended and the keyboard is free. From
    // then on nothing about the drag may close it.
    if (target.kind === "choose") {
      exploring = true;
      return;
    }
    void fileDrop(target);
  });
  ipcMain.on("magpie:drop-cancel", () => hideDropPanel());
  ipcMain.on("magpie:drop-explore", () => {
    // The drag is over by now, so the panel can take focus and a keyboard.
    // The card resizes itself in CSS; nothing here has to move.
    exploring = true;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    dropView?.webContents.focus();
  });

  ipcMain.on("magpie:hold-status", () => {
    // The tag field has focus, so stop the bar collapsing out from under it.
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
  });
  ipcMain.on("magpie:dismiss-status", () => {
    setStatus({ kind: "idle", message: "", expanded: false });
  });

  ipcMain.handle("magpie:tag", async (_e, bookmarkId: string, raw: string) => {
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      return { ok: true };
    }
    try {
      await addTags(bookmarkId, names);
      setStatus(
        {
          kind: "saved",
          message: "Tagged " + names.join(", "),
          expanded: false,
        },
        3000,
      );
      return { ok: true };
    } catch (e) {
      failed("tagging", e);
      return { ok: false };
    }
  });

  ipcMain.handle("magpie:undo", async (_e, bookmarkId: string) => {
    try {
      await deleteBookmark(bookmarkId);
      logLine("browser undo " + bookmarkId);
      setStatus({ kind: "idle", message: "Undone", expanded: false }, 2500);
      return { ok: true };
    } catch (e) {
      failed("undo", e);
      return { ok: false };
    }
  });

  ipcMain.on("magpie:menu", () => {
    const blocking = getSettings().adblockEnabled;
    Menu.buildFromTemplate([
      {
        label: "Block ads and trackers",
        type: "checkbox",
        checked: blocking,
        click: () => void toggleAdblock(),
      },
      { type: "separator" },
      {
        label: "Open Karakeep in your browser",
        enabled: isConfigured(),
        click: () => void shell.openExternal(getSettings().serverUrl),
      },
      { type: "separator" },
      {
        label: "Save this page to Karakeep",
        accelerator: "Ctrl+S",
        enabled: isConfigured(),
        click: () => void savePage(),
      },
      {
        label: "Settings…",
        click: () => openSettingsWindow?.(),
      },
    ]).popup({ window: win ?? undefined });
  });

  ipcMain.on("magpie:bookmark-open", (_e, url: string) => {
    // Behaves like a pinned tab: go to the one already showing it, use the
    // blank tab you are sitting on, or open a new one. Never replaces a page
    // you were reading.
    const open = tabs.find((t) => t.view.webContents.getURL() === url);
    if (open) {
      selectTab(open.id);
      return;
    }
    const wc = activeContents();
    if (wc && (wc.getURL() === HOME || wc.getURL() === "")) {
      void wc.loadURL(url);
      return;
    }
    selectTab(openTab(url).id);
  });

  ipcMain.on("magpie:tab-menu", (_e, id: number) => {
    const tab = tabOf(id);
    if (!tab) {
      return;
    }
    const wc = tab.view.webContents;
    const savable = /^https?:/i.test(wc.getURL());
    Menu.buildFromTemplate([
      {
        label: "Save this page to Karakeep",
        accelerator: "Ctrl+S",
        enabled: savable && isConfigured(),
        click: () => {
          selectTab(id);
          void savePage();
        },
      },
      { type: "separator" },
      { label: "Reload", click: () => wc.reload() },
      { label: "Duplicate", click: () => selectTab(openTab(wc.getURL()).id) },
      { type: "separator" },
      { label: "Close tab", click: () => closeTab(id) },
    ]).popup({ window: win ?? undefined });
  });

  ipcMain.on("magpie:bookmark-menu", (_e, url: string) => {
    const s = getSettings();
    const isHome = s.homeUrl === url;
    Menu.buildFromTemplate([
      {
        label: "Open this when Magpie starts",
        type: "checkbox",
        checked: isHome,
        click: () => {
          saveSettings({ homeUrl: isHome ? null : url });
          pushState();
        },
      },
      { type: "separator" },
      {
        label: "Open in a new tab",
        click: () => selectTab(openTab(url).id),
      },
      {
        label: "Remove from the toolbar",
        click: () => {
          saveSettings({
            bookmarks: getSettings().bookmarks.filter((b) => b.url !== url),
            ...(isHome ? { homeUrl: null } : {}),
          });
          // The bar may have just disappeared, freeing its height.
          layout();
          pushState();
        },
      },
    ]).popup({ window: win ?? undefined });
  });

  ipcMain.on("magpie:win-minimize", () => win?.minimize());
  ipcMain.on("magpie:win-maximize", () => {
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on("magpie:win-close", () => win?.close());

  ipcMain.on("magpie:open-in-karakeep", (_e, bookmarkId: string) => {
    const { serverUrl } = getSettings();
    if (serverUrl) {
      void shell.openExternal(serverUrl + "/dashboard/preview/" + bookmarkId);
    }
  });
}
