import { contextBridge, ipcRenderer } from "electron";

import {
  ClipboardIngestRequest,
  ConnectionResult,
  IngestRequest,
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
  ingest: (req: IngestRequest): Promise<IngestResult> =>
    ipcRenderer.invoke("drop:ingest", req),
  dismissOverlay: (): void => ipcRenderer.send("overlay:dismiss"),
  diag: (line: string): void => ipcRenderer.send("drop:diag", line),
  dropWasEmpty: (req: ClipboardIngestRequest): void =>
    ipcRenderer.send("drop:empty", req),
  onOverlayShow: (fn: () => void): void => {
    ipcRenderer.on("overlay:show", () => fn());
  },
  onOverlayHide: (fn: () => void): void => {
    ipcRenderer.on("overlay:hide", () => fn());
  },
};

contextBridge.exposeInMainWorld("karakeep", api);

export type KarakeepBridge = typeof api;
