import { EventEmitter } from "node:events";
import { getSettings } from "./config";

/**
 * Watches the whole desktop for the start of a drag.
 *
 * There is no cross-application "a drag began" signal on Windows, so this
 * infers one: left button down, then the cursor travels past a threshold
 * while it's still held. That's the same heuristic Eagle and Dropover use.
 * It fires for text selection too, which is why the overlay is cheap to show
 * and disappears the instant the button comes up.
 */
class DragWatcher extends EventEmitter {
  private origin: { x: number; y: number } | null = null;
  private dragging = false;
  private started = false;
  private modifiers = { ctrl: false, alt: false, shift: false };

  /** Emitted once per drag, at the point the threshold is crossed. */
  declare on: ((
    e: "dragstart",
    fn: (pos: { x: number; y: number }) => void,
  ) => this) &
    ((e: "dragend", fn: () => void) => this);

  start(): void {
    if (this.started) {
      return;
    }
    // Required lazily: it's a native addon, and importing it at module load
    // would crash the whole app on a machine where the binary won't load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { uIOhook, UiohookKey } = require("uiohook-napi") as typeof import("uiohook-napi");

    const MODIFIER_KEYCODES: Record<string, number[]> = {
      ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
      alt: [UiohookKey.Alt, UiohookKey.AltRight],
      shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
    };

    uIOhook.on("keydown", (e) => {
      for (const [name, codes] of Object.entries(MODIFIER_KEYCODES)) {
        if (codes.includes(e.keycode)) {
          this.modifiers[name as keyof typeof this.modifiers] = true;
        }
      }
    });
    uIOhook.on("keyup", (e) => {
      for (const [name, codes] of Object.entries(MODIFIER_KEYCODES)) {
        if (codes.includes(e.keycode)) {
          this.modifiers[name as keyof typeof this.modifiers] = false;
        }
      }
    });

    uIOhook.on("mousedown", (e) => {
      if (e.button === 1) {
        this.origin = { x: e.x, y: e.y };
        this.dragging = false;
      }
    });

    uIOhook.on("mousemove", (e) => {
      if (!this.origin || this.dragging) {
        return;
      }
      const settings = getSettings();
      if (!settings.overlayEnabled) {
        return;
      }
      if (
        settings.triggerMode === "modifier" &&
        !this.modifiers[settings.modifierKey]
      ) {
        return;
      }
      const dx = e.x - this.origin.x;
      const dy = e.y - this.origin.y;
      if (Math.hypot(dx, dy) < settings.dragThreshold) {
        return;
      }
      this.dragging = true;
      this.emit("dragstart", { x: e.x, y: e.y });
    });

    uIOhook.on("mouseup", (e) => {
      if (e.button !== 1) {
        return;
      }
      this.origin = null;
      if (this.dragging) {
        this.dragging = false;
        this.emit("dragend");
      }
    });

    uIOhook.start();
    this.started = true;
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    const { uIOhook } = require("uiohook-napi") as typeof import("uiohook-napi");
    uIOhook.stop();
    this.started = false;
  }
}

export const dragWatcher = new DragWatcher();
