import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, Session } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";

/**
 * Blocking is per-session and the engine is expensive to build, so one engine
 * is shared and `enableBlockingInSession` is what gets called per session.
 */
let engine: ElectronBlocker | null = null;
let loading: Promise<ElectronBlocker | null> | null = null;

async function load(): Promise<ElectronBlocker | null> {
  try {
    // "Full" is ads + tracking + annoyances. Annoyances is the one that earns
    // its place here rather than in an ordinary browser: a cookie banner
    // caught in an archive is baked in forever, and no later reader can
    // dismiss it.
    return await ElectronBlocker.fromPrebuiltFull(fetch, {
      // Cached to disk, so only the first launch pays for the lists.
      path: join(app.getPath("userData"), "adblock-engine.bin"),
      read: readFile,
      write: writeFile,
    });
  } catch (e) {
    // Offline, or the lists moved. Browsing unblocked beats not browsing.
    console.error("[magpie] ad blocking unavailable:", e);
    return null;
  }
}

export async function enableAdblock(session: Session): Promise<boolean> {
  loading ??= load();
  engine = await loading;
  if (!engine) {
    return false;
  }
  if (!engine.isBlockingEnabled(session)) {
    engine.enableBlockingInSession(session);
  }
  return true;
}

export function setAdblockEnabled(session: Session, on: boolean): boolean {
  if (!engine) {
    return false;
  }
  if (on) {
    if (!engine.isBlockingEnabled(session)) {
      engine.enableBlockingInSession(session);
    }
  } else if (engine.isBlockingEnabled(session)) {
    engine.disableBlockingInSession(session);
  }
  return engine.isBlockingEnabled(session);
}

export function isAdblockOn(session: Session): boolean {
  return engine?.isBlockingEnabled(session) ?? false;
}
