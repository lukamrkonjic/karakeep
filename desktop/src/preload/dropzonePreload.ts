import { contextBridge, ipcRenderer } from "electron";

import {
  DropPanelState,
  DropTarget,
  PickerList,
  PickerNode,
} from "../shared/types";

/** Bridge for the drop panel. Attached only to the panel's own page. */
const api = {
  onShow: (fn: (state: DropPanelState) => void): void => {
    ipcRenderer.on("magpie:drop-show", (_e, s: DropPanelState) => fn(s));
  },
  /** Lists that arrived after the panel was already on screen. */
  onLists: (
    fn: (lists: {
      recent: PickerList[];
      all: PickerList[];
      tree: PickerNode[];
    }) => void,
  ): void => {
    ipcRenderer.on("magpie:drop-lists", (_e, l) => fn(l));
  },
  /** Play the exit animation; the view is taken away once it has run. */
  onHide: (fn: () => void): void => {
    ipcRenderer.on("magpie:drop-hide", () => fn());
  },
  drop: (target: DropTarget): void => ipcRenderer.send("magpie:drop", target),
  cancel: (): void => ipcRenderer.send("magpie:drop-cancel"),
  /** Grows the panel into the explorer and gives it focus. */
  explore: (): void => ipcRenderer.send("magpie:drop-explore"),
};

contextBridge.exposeInMainWorld("magpieDrop", api);

export type MagpieDropBridge = typeof api;
