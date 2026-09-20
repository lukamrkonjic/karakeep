import { contextBridge, ipcRenderer } from "electron";

import { BrowserState, StatusState } from "../shared/types";

/**
 * The chrome's bridge. This preload is only ever attached to the browser
 * window's own page — never to a tab — so nothing a site can run reaches it.
 */
const api = {
  onState: (fn: (s: BrowserState) => void): void => {
    ipcRenderer.on("magpie:state", (_e, s: BrowserState) => fn(s));
  },
  onStatus: (fn: (s: StatusState) => void): void => {
    ipcRenderer.on("magpie:status", (_e, s: StatusState) => fn(s));
  },
  onFocusOmnibox: (fn: () => void): void => {
    ipcRenderer.on("magpie:focus-omnibox", () => fn());
  },

  navigate: (text: string): void => ipcRenderer.send("magpie:navigate", text),
  newTab: (): void => ipcRenderer.send("magpie:new-tab"),
  selectTab: (id: number): void => ipcRenderer.send("magpie:select-tab", id),
  closeTab: (id: number): void => ipcRenderer.send("magpie:close-tab", id),
  back: (): void => ipcRenderer.send("magpie:back"),
  forward: (): void => ipcRenderer.send("magpie:forward"),
  reload: (): void => ipcRenderer.send("magpie:reload"),
  savePage: (): void => ipcRenderer.send("magpie:save-page"),

  openBookmark: (url: string): void =>
    ipcRenderer.send("magpie:bookmark-open", url),
  bookmarkMenu: (url: string): void =>
    ipcRenderer.send("magpie:bookmark-menu", url),
  tabMenu: (id: number): void => ipcRenderer.send("magpie:tab-menu", id),

  minimize: (): void => ipcRenderer.send("magpie:win-minimize"),
  toggleMaximize: (): void => ipcRenderer.send("magpie:win-maximize"),
  close: (): void => ipcRenderer.send("magpie:win-close"),

  holdStatus: (): void => ipcRenderer.send("magpie:hold-status"),
  dismissStatus: (): void => ipcRenderer.send("magpie:dismiss-status"),
  tag: (bookmarkId: string, tags: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("magpie:tag", bookmarkId, tags),
  undo: (bookmarkId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("magpie:undo", bookmarkId),
  openInKarakeep: (bookmarkId: string): void =>
    ipcRenderer.send("magpie:open-in-karakeep", bookmarkId),
  openMenu: (): void => ipcRenderer.send("magpie:menu"),
};

contextBridge.exposeInMainWorld("magpie", api);

export type MagpieBridge = typeof api;
