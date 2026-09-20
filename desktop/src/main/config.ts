import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { BAKED_API_KEY, BAKED_SERVER_URL } from "../shared/defaults";
import { DEFAULT_SETTINGS, Settings } from "../shared/types";

const file = () => join(app.getPath("userData"), "settings.json");

let cached: Settings | null = null;
/** The mtime the cache was built from, so a changed file is noticed. */
let cachedMtime = -1;
/** Last time the file was stat-ed; getSettings is called very often. */
let checkedAt = 0;

export function getSettings(): Settings {
  if (cached) {
    const now = Date.now();
    if (now - checkedAt < 1000) {
      return cached;
    }
    checkedAt = now;
    try {
      // A cache that never expires keeps whatever it read first for the life
      // of the process, so a file edited by hand — or one that was briefly
      // unreadable — is wrong until the app is restarted.
      if (statSync(file()).mtimeMs === cachedMtime) {
        return cached;
      }
    } catch {
      return cached;
    }
  }
  try {
    const raw = JSON.parse(readFileSync(file(), "utf-8")) as Partial<Settings>;
    // Merge over the defaults so a settings file written by an older version
    // still boots when new keys are added.
    cached = { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  try {
    cachedMtime = statSync(file()).mtimeMs;
  } catch {
    cachedMtime = -1;
  }
  checkedAt = Date.now();

  // Whatever was saved wins; the compiled-in values are what a fresh install
  // and a cleared field fall back to.
  cached.serverUrl ||= BAKED_SERVER_URL;
  cached.apiKey ||= BAKED_API_KEY;
  return cached;
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...next };
  // Trailing slashes would double up when we join paths onto the base URL.
  merged.serverUrl = merged.serverUrl.trim().replace(/\/+$/, "");
  cached = merged;
  writeFileSync(file(), JSON.stringify(merged, null, 2), "utf-8");
  try {
    cachedMtime = statSync(file()).mtimeMs;
  } catch {
    cachedMtime = -1;
  }
  return merged;
}

export function isConfigured(): boolean {
  const s = getSettings();
  return s.serverUrl.length > 0 && s.apiKey.length > 0;
}
