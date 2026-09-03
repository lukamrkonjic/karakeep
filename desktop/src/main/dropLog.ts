import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { DropPayload } from "../shared/types";

/**
 * Records what each drop actually carried.
 *
 * Sites vary wildly in what they put on a drag, and when one defeats the
 * parser the flavour bodies are the only thing that says why — and they
 * cannot be recovered after the event. Kept local, capped, and plain text so
 * it can just be opened from the tray.
 */
const MAX_BYTES = 256 * 1024;

export function dropLogPath(): string {
  return join(app.getPath("userData"), "drops.log");
}

export function logDrop(payload: DropPayload, outcome: string): void {
  try {
    const path = dropLogPath();
    // Truncate rather than rotate: this is a debugging aid, not an audit
    // trail, and only the most recent drops are ever interesting.
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      writeFileSync(path, "", "utf-8");
    }

    const files =
      payload.files
        .map(
          (f) =>
            `${f.name || "(unnamed)"} ${f.type || "?"} ${f.bytes.byteLength}b`,
        )
        .join(" | ") || "(none)";

    const lines = [
      `--- ${new Date().toISOString()} — ${outcome}`,
      `types:      ${payload.types.join(", ") || "(none)"}`,
      `files:      ${files}`,
      `urls found: ${payload.urls.join("\n            ") || "(none)"}`,
      `title:      ${payload.title ?? "(none)"}`,
      `sourcePage: ${payload.sourcePageUrl ?? "(none)"}`,
    ];
    for (const [flavour, body] of Object.entries(payload.raw)) {
      lines.push("", `[${flavour}]`, body);
    }
    lines.push("", "");

    appendFileSync(path, lines.join("\n"), "utf-8");
  } catch {
    // Diagnostics must never break a drop.
  }
}
