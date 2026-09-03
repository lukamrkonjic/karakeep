import type { Settings } from "../shared/types";
import type { KarakeepBridge } from "../preload/preload";

declare global {
  interface Window {
    karakeep: KarakeepBridge;
  }
}

const api = window.karakeep;

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const serverUrl = $<HTMLInputElement>("serverUrl");
const apiKey = $<HTMLInputElement>("apiKey");
const copyMode = $<HTMLSelectElement>("copyMode");
const copyHotkey = $<HTMLInputElement>("copyHotkey");
const result = $<HTMLSpanElement>("result");

function setResult(text: string, kind: "ok" | "err" | ""): void {
  result.textContent = text;
  result.className = kind ? `result ${kind}` : "result";
}

async function load(): Promise<void> {
  const s = await api.getSettings();
  serverUrl.value = s.serverUrl;
  apiKey.value = s.apiKey;
  copyMode.value = s.copyMode;
  copyHotkey.value = s.copyHotkey;
}

function collect(): Partial<Settings> {
  return {
    serverUrl: serverUrl.value,
    apiKey: apiKey.value.trim(),
    copyMode: copyMode.value as Settings["copyMode"],
    copyHotkey: copyHotkey.value.trim() || "Control+Alt+S",
  };
}

$("save").addEventListener("click", () => {
  void (async () => {
    await api.saveSettings(collect());
    setResult("Saved", "ok");
  })();
});

$("test").addEventListener("click", () => {
  void (async () => {
    setResult("Testing…", "");
    // Test against what's on screen, not what was last saved.
    await api.saveSettings(collect());
    const res = await api.testConnection();
    if (res.ok) {
      setResult(
        res.version ? `Connected (server ${res.version})` : "Connected",
        "ok",
      );
    } else {
      setResult(res.error ?? "Failed", "err");
    }
  })();
});

void load();
