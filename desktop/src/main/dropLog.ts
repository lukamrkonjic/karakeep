import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * A small local record of what the app tried to save and how it went. Kept
 * because a failure that only reproduces against a real site is otherwise
 * impossible to diagnose after the fact.
 */
const MAX_BYTES = 256 * 1024;

export function dropLogPath(): string {
  // .txt, not .log: Windows has no default handler for .log, so
  // shell.openPath silently does nothing and the log looks absent.
  return join(app.getPath("userData"), "drops.txt");
}

export function logLine(line: string): void {
  try {
    const path = dropLogPath();
    // Truncate rather than rotate: this is a debugging aid, not an audit
    // trail, and only the most recent entries are ever interesting.
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      writeFileSync(path, "", "utf-8");
    }
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`, "utf-8");
  } catch {
    // Diagnostics must never break a save.
  }
}
