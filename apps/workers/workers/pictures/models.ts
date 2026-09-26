import { Mutex } from "async-mutex";

import logger from "@karakeep/shared/logger";

import type { PictureModel, TextModel } from "./clip";
import { openPictureModel, openTextModel } from "./clip";

/**
 * Fork: the picture model's two halves, shared by every job in the workers
 * (fingerprints, subscriptions skipping near-duplicates, search by
 * description): loaded when first needed — downloaded, the first time — used
 * by one caller at a time, and let go of after a while unused, as each takes
 * about half a gigabyte.
 */
class SharedModel<M extends { close(): Promise<void> }> {
  private loaded: M | null = null;
  private readonly lock = new Mutex();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly name: string,
    private readonly open: (signal?: AbortSignal) => Promise<M>,
    private readonly idleMs: number,
  ) {}

  /** Runs `fn` with the model, loading it first if need be. */
  use<T>(fn: (model: M) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.lock.runExclusive(async () => {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      try {
        if (!this.loaded) {
          signal?.throwIfAborted();
          this.loaded = await this.open(signal);
          logger.info(`[pictures] Loaded the ${this.name} model`);
        }
        return await fn(this.loaded);
      } finally {
        this.releaseLater();
      }
    });
  }

  private releaseLater() {
    this.idleTimer = setTimeout(() => {
      void this.lock.runExclusive(async () => {
        const model = this.loaded;
        this.loaded = null;
        if (model) {
          await model.close().catch(() => undefined);
          logger.info(`[pictures] Let go of the ${this.name} model (unused)`);
        }
      });
    }, this.idleMs);
    // Nothing to wait for at shutdown.
    this.idleTimer.unref?.();
  }
}

export const pictureModel = new SharedModel<PictureModel>(
  "picture",
  openPictureModel,
  2 * 60_000,
);

// Searches come in bursts: kept a little longer.
export const textModel = new SharedModel<TextModel>(
  "text",
  openTextModel,
  10 * 60_000,
);
