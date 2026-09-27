import { and, eq, isNotNull } from "drizzle-orm";

import type { FingerprintKind, PictureVector } from "@karakeep/shared-server";
import type { DuplicateMatchLevel } from "@karakeep/shared/types/duplicatePictures";
import { db } from "@karakeep/db";
import { pictureEmbeddingsTable } from "@karakeep/db/schema";
import {
  bufferToVector,
  CLIP_MODEL_ID,
  pictureDistance,
  sameKind,
  vectorToBuffer,
  videoBookmarkIds,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";
import { DUPLICATE_MATCH_LEVELS } from "@karakeep/shared/types/duplicatePictures";

import { errorMessage } from "./jobs";
import { pictureModel } from "./models";
import { videoFrame, videoLength } from "./video";

/**
 * Fork: "Skip near-duplicates" on a list subscription. A picture it brings in
 * that looks like one the user has — as alike as Settings → Pictures says —
 * is linked into the list instead of downloaded again. It goes by the
 * fingerprints of the user's pictures, and gives each picture it lets in its
 * fingerprint straight away, so a later copy in the same sync is caught too
 * (and the fingerprints job has nothing left to do for it). A video is
 * checked the cheap way, by one frame and its length (video.ts), against
 * the user's videos only; one it lets in is remembered for the rest of the
 * sync, and fingerprinted by the fingerprints job once its first-frame
 * picture is made.
 */

export interface Looked {
  vector: Float32Array;
  width: number;
  height: number;
  /** A video's length; undefined for a picture. */
  duration?: number;
}

type Known = PictureVector & { kind: FingerprintKind };

export class NearDuplicateFinder {
  private broken = false;

  private constructor(
    private readonly userId: string,
    private readonly pictures: Known[],
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
        duration: pictureEmbeddingsTable.duration,
      })
      .from(pictureEmbeddingsTable)
      .where(
        and(
          eq(pictureEmbeddingsTable.userId, userId),
          isNotNull(pictureEmbeddingsTable.embedding),
        ),
      );
    const videos = await videoBookmarkIds(db, userId);
    return new NearDuplicateFinder(
      userId,
      rows.map((r) => ({
        id: r.id,
        vector: bufferToVector(r.embedding!),
        kind: { video: videos.has(r.id), duration: r.duration },
      })),
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
    return this.lookAt(image, { video: false, duration: null }, signal);
  }

  /**
   * The same for a downloaded video, by one frame and its length. Null when
   * it can't be measured or its frame read: it's let in.
   */
  async lookVideo(
    file: string,
    signal?: AbortSignal,
  ): Promise<{ looked: Looked; match: string | null } | null> {
    if (this.broken) {
      return null;
    }
    const duration = await videoLength(file);
    if (duration <= 0) {
      return null;
    }
    let frame: Buffer;
    try {
      frame = await videoFrame(file, duration);
    } catch (error) {
      logger.warn(
        `[subscription] Couldn't check a video for a near-duplicate: ${errorMessage(error)}`,
      );
      return null;
    }
    const seen = await this.lookAt(frame, { video: true, duration }, signal);
    return seen && { ...seen, looked: { ...seen.looked, duration } };
  }

  private async lookAt(
    image: Buffer,
    kind: FingerprintKind,
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
      if (!sameKind(kind, picture.kind)) {
        continue;
      }
      const distance = pictureDistance(looked.vector, picture.vector);
      if (distance <= closest) {
        closest = distance;
        match = picture.id;
      }
    }
    return { looked, match };
  }

  /**
   * Gives a picture it let in its fingerprint. A video is only remembered
   * for this sync: its fingerprint is of its first-frame picture, which the
   * preprocessing worker hasn't made yet.
   */
  async remember(bookmarkId: string, assetId: string, looked: Looked) {
    if (looked.duration !== undefined) {
      this.pictures.push({
        id: bookmarkId,
        vector: looked.vector,
        kind: { video: true, duration: looked.duration },
      });
      return;
    }
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
    this.pictures.push({
      id: bookmarkId,
      vector: looked.vector,
      kind: { video: false, duration: null },
    });
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
