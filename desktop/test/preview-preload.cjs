// Stands in for the real preload so the UI can be rendered without a server.
const { contextBridge } = require("electron");
const emptyDrops = [];
const saved = [];
const copyModeHandlers = [];
const lists = [
  { id: "1", name: "Design", icon: "🎨", parentId: null, type: "manual", position: 9, userRole: "owner",
    children: [
      { id: "1a", name: "Typography", icon: "🔤", parentId: "1", type: "manual", position: 3, userRole: "owner", children: [] },
      { id: "1b", name: "Colour", icon: "📁", parentId: "1", type: "manual", position: 2, userRole: "owner", children: [] },
    ] },
  { id: "2", name: "Reference", icon: "📚", parentId: null, type: "manual", position: 8, userRole: "owner", children: [
      { id: "2a", name: "Interiors", icon: "🛋️", parentId: "2", type: "manual", position: 1, userRole: "owner", children: [] },
  ] },
  { id: "3", name: "Film stills", icon: "🎬", parentId: null, type: "manual", position: 7, userRole: "owner", children: [] },
  { id: "4", name: "To sort", icon: "??", parentId: null, type: "manual", position: 6, userRole: "owner", children: [] },
];
contextBridge.exposeInMainWorld("__test", {
  emptyDrops: () => emptyDrops,
  saved: () => saved,
  enterCopyMode: (kind) => copyModeHandlers.forEach((f) => f(kind)),
});
contextBridge.exposeInMainWorld("karakeep", {
  getSettings: async () => ({ serverUrl: "https://karakeep.example.com", apiKey: "ak1_demo",
    dragThreshold: 45, overlayEnabled: true, triggerMode: "always", modifierKey: "ctrl" }),
  saveSettings: async (p) => p,
  testConnection: async () => ({ ok: true, version: "0.33.2" }),
  getLists: async () => lists,
  ingest: async () => ({ ok: true }),
  dismissOverlay: () => {},
  diag: () => {},
  dropWasEmpty: (req) => emptyDrops.push(req),
  saveClipboard: async (req) => { saved.push(req); return { ok: true }; },
  dismissClipboard: () => {},
  onCopyMode: (fn) => { copyModeHandlers.push(fn); },
  onOverlayShow: () => {},
  onOverlayHide: () => {},
});
