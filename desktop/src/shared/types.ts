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
  /** Pixels the cursor must travel with the button held before we pop up. */
  dragThreshold: number;
  /** Master switch for the global drag watcher. */
  overlayEnabled: boolean;
  /**
   * Watch for media links/images copied in a browser and offer to save them.
   * The only way in for sites whose drags carry no data (Pinterest), and for
   * media that can't be dragged at all (a YouTube video).
   */
  copyToSave: boolean;
  /** Start with Windows. Off unless the user turns it on. */
  launchAtLogin: boolean;
  /**
   * listId -> epoch ms of the last drop into it. The server doesn't expose
   * list timestamps, so "recent" is this app's own record of what you use.
   */
  recentLists: Record<string, number>;
  /**
   * "always" pops the overlay on any drag; "modifier" requires the trigger
   * key to be held, which is the escape hatch if "always" feels noisy.
   */
  triggerMode: "always" | "modifier";
  modifierKey: "ctrl" | "alt" | "shift";
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "",
  apiKey: "",
  dragThreshold: 45,
  overlayEnabled: true,
  copyToSave: true,
  launchAtLogin: false,
  recentLists: {},
  triggerMode: "always",
  modifierKey: "ctrl",
};

/**
 * What the renderer scrapes out of a native drop. Exactly one of `files` or
 * `urls` is usually populated, but a browser drag often yields both, in which
 * case the raw bytes win — see resolveMedia().
 */
export interface DropPayload {
  /** Real bytes, when the OS handed us an actual file. */
  files: { name: string; type: string; bytes: ArrayBuffer }[];
  /** Candidate media URLs, best first. */
  urls: string[];
  /** The page the drag originated from, used as a Referer when downloading. */
  sourcePageUrl: string | null;
  /** Suggested title (an <img alt>, a link text, or a Firefox x-moz-url title). */
  title: string | null;
  /** Every MIME type the drop advertised — kept for the payload inspector. */
  types: string[];
  /**
   * The raw flavour bodies, truncated. Only ever written to the local drop
   * log: when a site's markup defeats the parser this is the single thing
   * that says why, and it can't be reconstructed after the event.
   */
  raw: Record<string, string>;
}

export interface IngestRequest {
  payload: DropPayload;
  /** Target list, or null to save without filing it anywhere. */
  listId: string | null;
  /** Only for the confirmation toast — the server is addressed by id. */
  listName: string | null;
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
