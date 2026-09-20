/**
 * A page kept on the toolbar for one click back to it.
 *
 * The icon is a data: URL rather than a remote one, so the bar draws with no
 * network, survives the site going down, and needs no loosening of the
 * chrome's content security policy.
 */
export interface SavedBookmark {
  url: string;
  title: string;
  icon: string;
}

/** A list as returned by GET /api/v1/lists. */
export interface KarakeepList {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  type: "manual" | "smart";
  /** Sort key among siblings — higher sorts first, matching the web sidebar. */
  position: number;
  userRole: "owner" | "editor" | "viewer" | "public";
}

/** A list plus its children, as rendered in the overlay tree. */
export interface ListNode extends KarakeepList {
  children: ListNode[];
  /**
   * Last use of this list *or anything under it*, so a folder whose subfolder
   * you keep dropping into rises too instead of being stranded at the bottom.
   */
  recencyKey: number;
}

export interface Settings {
  serverUrl: string;
  apiKey: string;
  /**
   * How a copied link or image gets saved — the way in for sites whose drags
   * carry no data (Pinterest) and for media that can't be dragged at all (a
   * YouTube video).
   *
   * "hotkey" never shows anything you didn't ask for, so it's the default.
   * "auto" opens the picker by itself whenever media is copied in a browser,
   * which is fewer keystrokes but appears unbidden.
   */
  copyMode: "off" | "hotkey" | "auto";
  /** Accelerator for copyMode "hotkey", in Electron's syntax. */
  copyHotkey: string;
  /** Start with Windows. Off unless the user turns it on. */
  launchAtLogin: boolean;
  /** Pages kept on the collector browser's toolbar. */
  bookmarks: SavedBookmark[];
  /** The bookmark the browser opens on, if one has been chosen. */
  homeUrl: string | null;
  /**
   * Ad and tracker blocking in the collector browser.
   *
   * Off by default, and a real switch rather than a fact of life. The engine
   * breaks some sites outright: Pinterest renders an empty shell with it on,
   * at every filter-list level, though uBlock Origin has no such trouble with
   * the same site. A browser that shows blank pages out of the box is broken,
   * so this starts off and the toolbar button turns it on.
   */
  adblockEnabled: boolean;
  /**
   * listId -> epoch ms of the last drop into it. The server doesn't expose
   * list timestamps, so "recent" is this app's own record of what you use.
   */
  recentLists: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "",
  apiKey: "",
  copyMode: "hotkey",
  copyHotkey: "Control+Alt+S",
  launchAtLogin: false,
  bookmarks: [],
  homeUrl: null,
  adblockEnabled: false,
  recentLists: {},
};

/** A single thing to save: either a URL to fetch, or bytes already in hand. */
export interface SaveSource {
  url: string | null;
  bytes: Uint8Array<ArrayBuffer> | null;
  /** Suggested title, when the source offered one. */
  title: string | null;
}

/** Saving whatever is on the clipboard, used to rescue a data-less drag. */
export interface ClipboardIngestRequest {
  listId: string | null;
  listName: string | null;
}

/** Saving whatever was just copied, used by copy-to-save. */
export interface ClipboardIngestRequest {
  listId: string | null;
  listName: string | null;
}

export interface IngestResult {
  ok: boolean;
  bookmarkId?: string;
  alreadyExists?: boolean;
  listName?: string | null;
  error?: string;
}

export interface ConnectionResult {
  ok: boolean;
  /** Server-reported version on success. */
  version?: string;
  error?: string;
}

/* ---------------- Collector browser ---------------- */

/** One tab, reduced to what the chrome has to draw. */
export interface TabState {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserState {
  tabs: TabState[];
  activeId: number | null;
  bookmarks: SavedBookmark[];
  /** Which bookmark opens on launch, so the bar can mark it. */
  homeUrl: string | null;
  /** Drives the maximise/restore glyph, since there is no system frame. */
  maximized: boolean;
}

/**
 * The bottom bar. It is the browser's only feedback channel, so every save
 * ends here, and a finished one stays long enough to be tagged or undone —
 * the save itself has already happened by the time it appears.
 */
export interface StatusState {
  kind: "idle" | "working" | "saved" | "error";
  message: string;
  detail?: string;
  /** Present on "saved": what the tag field and Undo act on. */
  bookmarkId?: string;
  /** Whether the bar is showing its tall, interactive form. */
  expanded: boolean;
}

/** What the capture bridge hands back across IPC, in place of a Response. */
export interface FetchedResource {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/* ---------------- drag to file ---------------- */

/** The image under the cursor while the drop panel is up. */
export interface DragPayload {
  src: string;
  title: string | null;
  pageUrl: string;
}

/** A list flattened for the picker: its own name plus where it sits. */
export interface PickerList {
  id: string;
  name: string;
  /** Ancestors joined for display, so two "Refs" folders can be told apart. */
  path: string;
}

/** A list and everything filed under it, for the explorer. */
export interface PickerNode {
  id: string;
  name: string;
  icon: string;
  children: PickerNode[];
}

/** Everything the drop panel needs to draw itself. */
export interface DropPanelState {
  payload: DragPayload;
  /** Most recently filed into first — the whole point of the panel. */
  recent: PickerList[];
  /** Every list flattened, for searching. */
  all: PickerList[];
  /** The same lists nested, for browsing when there is no query. */
  tree: PickerNode[];
}

/** Where a drag landed. */
export type DropTarget =
  | { kind: "unsorted" }
  | { kind: "choose" }
  | { kind: "list"; id: string; name: string };
