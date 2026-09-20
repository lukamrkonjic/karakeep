import type { MagpieBridge } from "../preload/browserPreload";
import type { BrowserState, StatusState } from "../shared/types";

declare global {
  interface Window {
    magpie: MagpieBridge;
  }
}

const bridge = window.magpie;

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const tabstrip = $<HTMLDivElement>("tabstrip");
const omnibox = $<HTMLInputElement>("omnibox");
const backBtn = $<HTMLButtonElement>("back");
const fwdBtn = $<HTMLButtonElement>("forward");
const statusbar = $<HTMLElement>("statusbar");
const statusMsg = $<HTMLSpanElement>("status-msg");
const statusDetail = $<HTMLSpanElement>("status-detail");
const dot = $<HTMLSpanElement>("dot");
const tagbox = $<HTMLInputElement>("tagbox");
const undoBtn = $<HTMLButtonElement>("undo");
const openBtn = $<HTMLButtonElement>("open-in-karakeep");
const pinned = $<HTMLDivElement>("pinned");
const maxBtn = $<HTMLButtonElement>("win-max");

/** The bookmark the status bar's actions currently act on. */
let subject: string | null = null;
/** Left alone while the address bar has focus, so typing is never clobbered. */
let omniboxOwnedByUser = false;

/* ---------------- tabs ---------------- */

function renderTabs(state: BrowserState): void {
  tabstrip.replaceChildren();

  for (const t of state.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === state.activeId ? " active" : "");
    el.title = t.url;
    el.addEventListener("mousedown", (e) => {
      // Middle-click closes, the way it does everywhere else.
      if (e.button === 1) {
        e.preventDefault();
        bridge.closeTab(t.id);
      } else if (e.button === 0) {
        bridge.selectTab(t.id);
      }
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      bridge.tabMenu(t.id);
    });

    const label = document.createElement("span");
    label.className = "tab-title";
    label.textContent = t.loading ? "Loading…" : t.title;
    el.append(label);

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Close tab (Ctrl+W)";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      bridge.closeTab(t.id);
    });
    el.append(close);

    tabstrip.append(el);
  }

  const add = document.createElement("button");
  add.className = "tab-new";
  add.textContent = "+";
  add.title = "New tab (Ctrl+T)";
  add.addEventListener("click", () => bridge.newTab());
  tabstrip.append(add);

  renderPinned(state);

  // No system frame, so the glyph has to say which way the button goes.
  maxBtn.textContent = state.maximized ? "❐" : "□";
  maxBtn.title = state.maximized ? "Restore" : "Maximise";

  const active = state.tabs.find((t) => t.id === state.activeId);
  backBtn.disabled = !active?.canGoBack;
  fwdBtn.disabled = !active?.canGoForward;

  if (active && !omniboxOwnedByUser) {
    omnibox.value = active.url;
  }
}

/* ---------------- bookmarks ---------------- */

/*
 * Saved pages live in the tab strip as favicon-only tabs rather than on a row
 * of their own, which is a whole band of chrome back for the page.
 */
function renderPinned(state: BrowserState): void {
  pinned.replaceChildren();

  for (const mark of state.bookmarks) {
    const el = document.createElement("button");
    el.className = "pin" + (mark.url === state.homeUrl ? " home" : "");
    el.title =
      mark.url === state.homeUrl
        ? `${mark.title} — ${mark.url} — opens when Magpie starts`
        : `${mark.title} — ${mark.url}`;

    if (mark.icon) {
      const icon = document.createElement("img");
      icon.className = "pin-icon";
      icon.src = mark.icon;
      icon.alt = "";
      el.append(icon);
    } else {
      // A site with no usable icon still needs something to aim at.
      const initial = document.createElement("span");
      initial.className = "pin-icon pin-icon-blank";
      initial.textContent = (mark.title[0] ?? "?").toUpperCase();
      el.append(initial);
    }

    el.addEventListener("click", () => bridge.openBookmark(mark.url));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      bridge.bookmarkMenu(mark.url);
    });
    pinned.append(el);
  }
}

/* ---------------- status ---------------- */

function renderStatus(s: StatusState): void {
  subject = s.bookmarkId ?? null;

  statusbar.classList.toggle("expanded", s.expanded);
  statusbar.dataset.kind = s.kind;
  dot.dataset.kind = s.kind;

  statusMsg.textContent = s.message;
  statusDetail.textContent = s.detail ?? "";

  // Undo and Open only mean anything while there is a bookmark behind them.
  const actionable = Boolean(subject);
  undoBtn.hidden = !actionable;
  openBtn.hidden = !actionable;
  tagbox.hidden = !actionable;

  if (s.expanded && actionable) {
    tagbox.value = "";
  }
}

tagbox.addEventListener("focus", () => bridge.holdStatus());
tagbox.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && subject) {
    const value = tagbox.value;
    tagbox.value = "";
    void bridge.tag(subject, value);
  } else if (e.key === "Escape") {
    bridge.dismissStatus();
  }
});

undoBtn.addEventListener("click", () => {
  if (subject) {
    void bridge.undo(subject);
  }
});
openBtn.addEventListener("click", () => {
  if (subject) {
    bridge.openInKarakeep(subject);
  }
});

/* ---------------- toolbar ---------------- */

omnibox.addEventListener("focus", () => {
  omniboxOwnedByUser = true;
  omnibox.select();
});
omnibox.addEventListener("blur", () => {
  omniboxOwnedByUser = false;
});
omnibox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    omniboxOwnedByUser = false;
    bridge.navigate(omnibox.value);
    omnibox.blur();
  } else if (e.key === "Escape") {
    omnibox.blur();
  }
});

backBtn.addEventListener("click", () => bridge.back());
fwdBtn.addEventListener("click", () => bridge.forward());
$("reload").addEventListener("click", () => bridge.reload());

$("win-min").addEventListener("click", () => bridge.minimize());
maxBtn.addEventListener("click", () => bridge.toggleMaximize());
$("win-close").addEventListener("click", () => bridge.close());

// Everything that is not browsing lives behind one button, so the toolbar
// stays the address bar and the one thing this browser is for.
$("more").addEventListener("click", () => bridge.openMenu());

/* ---------------- wiring ---------------- */

bridge.onState(renderTabs);
bridge.onStatus(renderStatus);
bridge.onFocusOmnibox(() => omnibox.focus());

// The chrome has its own keyboard, because a tab's webContents never sees
// keys pressed while the address bar has focus.
window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "l") {
    e.preventDefault();
    omnibox.focus();
  } else if (ctrl && e.key.toLowerCase() === "t") {
    e.preventDefault();
    bridge.newTab();
  } else if (ctrl && e.key.toLowerCase() === "s") {
    e.preventDefault();
    bridge.savePage();
  }
});
