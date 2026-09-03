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
const triggerMode = $<HTMLSelectElement>("triggerMode");
const modifierKey = $<HTMLSelectElement>("modifierKey");
const dragThreshold = $<HTMLInputElement>("dragThreshold");
const result = $<HTMLSpanElement>("result");

function syncModifierVisibility(): void {
  const usesModifier = triggerMode.value === "modifier";
  modifierKey.disabled = !usesModifier;
  modifierKey.style.opacity = usesModifier ? "1" : "0.45";
}

function setResult(text: string, kind: "ok" | "err" | ""): void {
  result.textContent = text;
  result.className = kind ? `result ${kind}` : "result";
}

async function load(): Promise<void> {
  const s = await api.getSettings();
  serverUrl.value = s.serverUrl;
  apiKey.value = s.apiKey;
  triggerMode.value = s.triggerMode;
  modifierKey.value = s.modifierKey;
  dragThreshold.value = String(s.dragThreshold);
  syncModifierVisibility();
}

function collect(): Partial<Settings> {
  return {
    serverUrl: serverUrl.value,
    apiKey: apiKey.value.trim(),
    triggerMode: triggerMode.value as Settings["triggerMode"],
    modifierKey: modifierKey.value as Settings["modifierKey"],
    dragThreshold: Math.min(
      400,
      Math.max(10, Number(dragThreshold.value) || 45),
    ),
  };
}

triggerMode.addEventListener("change", syncModifierVisibility);

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
