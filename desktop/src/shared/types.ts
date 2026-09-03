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
