import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { DEFAULT_SETTINGS, Settings } from "../shared/types";

const file = () => join(app.getPath("userData"), "settings.json");

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) {
    return cached;
  }
  try {
    const raw = JSON.parse(readFileSync(file(), "utf-8")) as Partial<Settings>;
    // Merge over the defaults so a settings file written by an older version
    // still boots when new keys are added.
    cached = { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...next };
  // Trailing slashes would double up when we join paths onto the base URL.
  merged.serverUrl = merged.serverUrl.trim().replace(/\/+$/, "");
  cached = merged;
  writeFileSync(file(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function isConfigured(): boolean {
  const s = getSettings();
  return s.serverUrl.length > 0 && s.apiKey.length > 0;
}
