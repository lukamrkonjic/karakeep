import { and, eq, isNotNull } from "drizzle-orm";

import type { PictureVector } from "@karakeep/shared-server";
import type { DuplicateMatchLevel } from "@karakeep/shared/types/duplicatePictures";
import { db } from "@karakeep/db";
import { pictureEmbeddingsTable } from "@karakeep/db/schema";
import {
  bufferToVector,
  CLIP_MODEL_ID,
  pictureDistance,
  vectorToBuffer,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DUPLICATE_MATCH_LEVELS } from "@karakeep/shared/types/duplicatePictures";

import { errorMessage } from "./jobs";
import { pictureModel } from "./models";

/**
 * Fork: "Skip near-duplicates" on a list subscription. A picture it brings in
 * that looks like one the user has — as alike as Settings → Pictures says —
 * is linked into the list instead of downloaded again. It goes by the
 * fingerprints of the user's pictures, and gives each picture it lets in its
 * fingerprint straight away, so a later copy in the same sync is caught too
 * (and the fingerprints job has nothing left to do for it).
 */

export interface Looked {
  vector: Float32Array;
  width: number;
  height: number;
}

export class NearDuplicateFinder {
  private broken = false;

  private constructor(
    private readonly userId: string,
    private readonly pictures: PictureVector[],
    private readonly maxDistance: number,
  ) {}

  static async forUser(
    userId: string,
    level: DuplicateMatchLevel,
  ): Promise<NearDuplicateFinder> {
    const rows = await db
      .select({
        id: pictureEmbeddingsTable.bookmarkId,
        embedding: pictureEmbeddingsTable.embedding,
      })
      .from(pictureEmbeddingsTable)
      .where(
        and(
          eq(pictureEmbeddingsTable.userId, userId),
          isNotNull(pictureEmbeddingsTable.embedding),
        ),
      );
    return new NearDuplicateFinder(
      userId,
      rows.map((r) => ({ id: r.id, vector: bufferToVector(r.embedding!) })),
      DUPLICATE_MATCH_LEVELS[level],
    );
  }

  /**
   * The picture's fingerprint, and the user's picture most like it if it's
   * alike enough. Null when the model can't be had: the sync goes on
   * without the check.
   */
  async look(
    image: Buffer,
    signal?: AbortSignal,
  ): Promise<{ looked: Looked; match: string | null } | null> {
    if (this.broken) {
      return null;
    }
    let looked: Looked;
    try {
      looked = await pictureModel.use((model) => model.embed(image), signal);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // A picture the model can't read is let in; a model that can't be
      // loaded stops the checking for this sync.
      if (!(await this.modelWorks(signal))) {
        this.broken = true;
      }
      logger.warn(
        `[subscription] Couldn't check for a near-duplicate: ${errorMessage(error)}`,
      );
      return null;
    }
    let match: string | null = null;
    let closest = this.maxDistance;
    for (const picture of this.pictures) {
      const distance = pictureDistance(looked.vector, picture.vector);
      if (distance <= closest) {
        closest = distance;
        match = picture.id;
      }
    }
    return { looked, match };
  }

  /** Gives a picture it let in its fingerprint. */
  async remember(bookmarkId: string, assetId: string, looked: Looked) {
    const row = {
      userId: this.userId,
      assetId,
      model: CLIP_MODEL_ID,
      embedding: vectorToBuffer(looked.vector),
      width: looked.width,
      height: looked.height,
      compared: false,
      suggested: false,
      createdAt: new Date(),
    };
    await db
      .insert(pictureEmbeddingsTable)
      .values({ bookmarkId, ...row })
      .onConflictDoUpdate({
        target: pictureEmbeddingsTable.bookmarkId,
        set: row,
      })
      .catch(() => undefined); // deleted meanwhile
    this.pictures.push({ id: bookmarkId, vector: looked.vector });
  }

  private async modelWorks(signal?: AbortSignal): Promise<boolean> {
    try {
      await pictureModel.use(async () => undefined, signal);
      return true;
    } catch {
      return false;
    }
  }
}
