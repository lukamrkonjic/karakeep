import { contextBridge, ipcRenderer } from "electron";

import {
  ClipboardIngestRequest,
  ConnectionResult,
  IngestResult,
  ListNode,
  Settings,
} from "../shared/types";

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke("settings:save", patch),
  testConnection: (): Promise<ConnectionResult> =>
    ipcRenderer.invoke("settings:test"),
  getLists: (): Promise<ListNode[]> => ipcRenderer.invoke("lists:get"),
  saveClipboard: (req: ClipboardIngestRequest): Promise<IngestResult> =>
    ipcRenderer.invoke("clipboard:save", req),
  dismissClipboard: (): void => ipcRenderer.send("clipboard:dismiss"),
  copyText: (text: string): void => ipcRenderer.send("settings:copy", text),
  onCopyMode: (fn: (kind: string) => void): void => {
    ipcRenderer.on("overlay:copy-mode", (_e, kind: string) => fn(kind));
  },
  onOverlayShow: (fn: () => void): void => {
    ipcRenderer.on("overlay:show", () => fn());
  },
  onOverlayHide: (fn: () => void): void => {
    ipcRenderer.on("overlay:hide", () => fn());
  },
};

contextBridge.exposeInMainWorld("karakeep", api);

export type KarakeepBridge = typeof api;
