import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { and, eq } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import PDFParser from "pdf2json";
import { fromBuffer } from "pdf2pic";
import { createWorker } from "tesseract.js";
import { withWorkerEventLog, withWorkerTracing } from "workerTracing";

import type { AssetPreprocessingRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
} from "@karakeep/db/schema";
import {
  addLogFields,
  AssetPreprocessingQueue,
  EmbeddingsQueue,
  OpenAIQueue,
  QuotaService,
  StorageQuotaError,
  triggerSearchReindex,
} from "@karakeep/shared-server";
import {
  newAssetId,
  readAsset,
  saveAsset,
  VIDEO_ASSET_TYPES,
} from "@karakeep/shared/assetdb";
import serverConfig from "@karakeep/shared/config";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import logger from "@karakeep/shared/logger";
import { buildOCRPrompt } from "@karakeep/shared/prompts";
import {
  DequeuedJob,
  EnqueueOptions,
  getQueueClient,
} from "@karakeep/shared/queueing";

export class AssetPreprocessingWorker {
  static async build() {
    logger.info("Starting asset preprocessing worker ...");
    const worker =
      (await getQueueClient())!.createRunner<AssetPreprocessingRequest>(
        AssetPreprocessingQueue,
        {
          run: withWorkerTracing(
            "assetPreprocessingWorker.run",
            withWorkerEventLog("assetPreprocessingWorker.run", run),
          ),
          onComplete: async (job) => {
            workerStatsCounter.labels("assetPreprocessing", "completed").inc();
            const jobId = job.id;
            logger.info(
              `[assetPreprocessing][${jobId}] Completed successfully`,
            );
            return Promise.resolve();
          },
          onError: async (job) => {
            workerStatsCounter.labels("assetPreProcessing", "failed").inc();
            if (job.numRetriesLeft == 0) {
              workerStatsCounter
                .labels("assetPreProcessing", "failed_permanent")
                .inc();
            }
            const jobId = job.id;
            logger.error(
              `[assetPreprocessing][${jobId}] Asset preprocessing failed: ${job.error}\n${job.error.stack}`,
            );

            const bookmarkId = job.data?.bookmarkId;
            if (bookmarkId && job.numRetriesLeft == 0) {
              await db.transaction(async (tx) => {
                await tx
                  .update(bookmarks)
                  .set({
                    taggingStatus: null,
                  })
                  .where(
                    and(
                      eq(bookmarks.id, bookmarkId),
                      eq(bookmarks.taggingStatus, "pending"),
                    ),
                  );
                await tx
                  .update(bookmarks)
                  .set({
                    summarizationStatus: null,
                  })
                  .where(
                    and(
                      eq(bookmarks.id, bookmarkId),
                      eq(bookmarks.summarizationStatus, "pending"),
                    ),
                  );
                await tx
                  .update(bookmarks)
                  .set({
                    embeddingStatus: null,
                  })
                  .where(
                    and(
                      eq(bookmarks.id, bookmarkId),
                      eq(bookmarks.embeddingStatus, "pending"),
                    ),
                  );
              });
            }
            return Promise.resolve();
          },
        },
        {
          concurrency: serverConfig.assetPreprocessing.numWorkers,
          pollIntervalMs: 1000,
          timeoutSecs: serverConfig.assetPreprocessing.jobTimeoutSec,
        },
      );

    return worker;
  }
}

async function readImageText(buffer: Buffer) {
  if (serverConfig.ocr.langs.length == 1 && serverConfig.ocr.langs[0] == "") {
    return null;
  }
  const worker = await createWorker(serverConfig.ocr.langs, undefined, {
    cachePath: serverConfig.ocr.cacheDir ?? os.tmpdir(),
  });
  try {
    const ret = await worker.recognize(buffer);
    if (ret.data.confidence <= serverConfig.ocr.confidenceThreshold) {
      return null;
    }
    return ret.data.text;
  } finally {
    await worker.terminate();
  }
}

async function readImageTextWithLLM(
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const inferenceClient = InferenceClientFactory.build();
  if (!inferenceClient) {
    logger.warn(
      "[assetPreprocessing] LLM OCR is enabled but no inference client is configured. Falling back to Tesseract.",
    );
    return readImageText(buffer);
  }

  const base64 = buffer.toString("base64");
  const prompt = buildOCRPrompt();

  const response = await inferenceClient.inferFromImage(
    prompt,
    contentType,
    base64,
    {
      schema: null,
    },
  );

  const extractedText = response.response.trim();
  if (!extractedText) {
    return null;
  }

  return extractedText;
}

async function readPDFText(buffer: Buffer): Promise<{
  text: string;
  metadata: Record<string, object>;
}> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, true);
    pdfParser.on("pdfParser_dataError", reject);
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      resolve({
        text: pdfParser.getRawTextContent(),
        metadata: pdfData.Meta,
      });
    });
    pdfParser.parseBuffer(buffer);
  });
}

export async function extractAndSavePDFScreenshot(
  jobId: string,
  asset: Buffer,
  bookmark: NonNullable<Awaited<ReturnType<typeof getBookmark>>>,
  isFixMode: boolean,
): Promise<boolean> {
  {
    const alreadyHasScreenshot =
      bookmark.assets.find(
        (r) => r.assetType === AssetTypes.ASSET_SCREENSHOT,
      ) !== undefined;
    if (alreadyHasScreenshot && isFixMode) {
      logger.info(
        `[assetPreprocessing][${jobId}] Skipping PDF screenshot generation as it's already been generated.`,
      );
      return false;
    }
  }
  logger.info(
    `[assetPreprocessing][${jobId}] Attempting to generate PDF screenshot for bookmarkId: ${bookmark.id}`,
  );
  try {
    /**
     * If you encountered any issues with this library, make sure you have ghostscript and graphicsmagick installed following this URL
     * https://github.com/yakovmeister/pdf2image/blob/HEAD/docs/gm-installation.md
     */
    const screenshot = await fromBuffer(asset, {
      density: 100,
      quality: 100,
      format: "png",
      preserveAspectRatio: true,
    })(1, { responseType: "buffer" });

    if (!screenshot.buffer) {
      logger.error(
        `[assetPreprocessing][${jobId}] Failed to generate PDF screenshot`,
      );
      return false;
    }

    // Check storage quota before inserting
    const quotaApproved = await QuotaService.checkStorageQuota(
      db,
      bookmark.userId,
      screenshot.buffer.byteLength,
    );

    // Store the screenshot
    const assetId = newAssetId();
    const fileName = "screenshot.png";
    const contentType = "image/png";
    await saveAsset({
      userId: bookmark.userId,
      assetId,
      asset: screenshot.buffer,
      metadata: {
        contentType,
        fileName,
      },
      quotaApproved,
    });

    // Insert into database
    await db.insert(assets).values({
      id: assetId,
      bookmarkId: bookmark.id,
      userId: bookmark.userId,
      assetType: AssetTypes.ASSET_SCREENSHOT,
      contentType,
      size: screenshot.buffer.byteLength,
      fileName,
    });

    logger.info(
      `[assetPreprocessing][${jobId}] Successfully saved PDF screenshot to database`,
    );
    return true;
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      logger.warn(
        `[assetPreprocessing][${jobId}] Skipping PDF screenshot due to quota exceeded: ${error.message}`,
      );
      return true; // Return true to indicate the job completed successfully, just skipped the asset
    }
    logger.error(
      `[assetPreprocessing][${jobId}] Failed to process PDF screenshot: ${error}`,
    );
    return false;
  }
}

const execFileAsync = promisify(execFile);

/**
 * Extracts the first frame of a video attachment via ffmpeg and saves it as
 * a companion LINK_VIDEO_THUMBNAIL asset, at the video's own aspect ratio
 * (no resizing beyond capping the width) so the feed can show a real
 * preview instead of a generic placeholder before the user clicks to play.
 *
 * Best-effort: a missing ffmpeg binary or a video ffmpeg can't decode logs
 * a warning and returns false rather than failing the job — the feed simply
 * falls back to the placeholder for that video.
 */
export async function extractAndSaveVideoThumbnail(
  jobId: string,
  bookmarkId: string,
  videoAssetId: string,
): Promise<boolean> {
  const videoAsset = await db.query.assets.findFirst({
    where: and(eq(assets.id, videoAssetId), eq(assets.bookmarkId, bookmarkId)),
  });
  // Covers both a video attached to a LINK bookmark (assetType linkVideo)
  // and a video uploaded directly as its own ASSET bookmark (assetType
  // bookmarkAsset) — the content type is the real signal, not the wrapper.
  if (
    !videoAsset ||
    !videoAsset.contentType ||
    !VIDEO_ASSET_TYPES.has(videoAsset.contentType)
  ) {
    logger.error(
      `[assetPreprocessing][${jobId}] Asset ${videoAssetId} is not a video attachment on bookmark ${bookmarkId}`,
    );
    return false;
  }

  const alreadyHasThumbnail = await db.query.assets.findFirst({
    where: and(
      eq(assets.bookmarkId, bookmarkId),
      eq(assets.assetType, AssetTypes.LINK_VIDEO_THUMBNAIL),
    ),
  });
  if (alreadyHasThumbnail) {
    logger.info(
      `[assetPreprocessing][${jobId}] Skipping video thumbnail generation as it's already been generated.`,
    );
    return false;
  }

  logger.info(
    `[assetPreprocessing][${jobId}] Attempting to generate a video thumbnail for bookmarkId: ${bookmarkId}`,
  );

  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "karakeep-video-thumb-"),
  );
  try {
    const { asset: videoBuffer } = await readAsset({
      userId: videoAsset.userId,
      assetId: videoAssetId,
    });

    const inputPath = path.join(tmpDir, "input.video");
    const outputPath = path.join(tmpDir, "thumbnail.jpg");
    await fs.writeFile(inputPath, videoBuffer);

    try {
      // Grab the first decodable frame (no -ss seek) so this works even for
      // very short clips; cap the width so oversized source videos don't
      // produce an oversized thumbnail, preserving the aspect ratio.
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        // Required by the image2 muxer for single-image (non-sequence)
        // output — without it ffmpeg warns and some versions may refuse.
        "-update",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-q:v",
        "4",
        outputPath,
      ]);
    } catch (error) {
      logger.warn(
        `[assetPreprocessing][${jobId}] ffmpeg failed to extract a video thumbnail (is ffmpeg installed?): ${error}`,
      );
      return false;
    }

    const thumbnailBuffer = await fs.readFile(outputPath);

    const quotaApproved = await QuotaService.checkStorageQuota(
      db,
      videoAsset.userId,
      thumbnailBuffer.byteLength,
    );

    const thumbnailAssetId = newAssetId();
    const fileName = "video-thumbnail.jpg";
    const contentType = "image/jpeg";
    await saveAsset({
      userId: videoAsset.userId,
      assetId: thumbnailAssetId,
      asset: thumbnailBuffer,
      metadata: {
        contentType,
        fileName,
      },
      quotaApproved,
    });

    await db.insert(assets).values({
      id: thumbnailAssetId,
      bookmarkId,
      userId: videoAsset.userId,
      assetType: AssetTypes.LINK_VIDEO_THUMBNAIL,
      contentType,
      size: thumbnailBuffer.byteLength,
      fileName,
    });

    logger.info(
      `[assetPreprocessing][${jobId}] Successfully saved video thumbnail to database`,
    );
    return true;
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      logger.warn(
        `[assetPreprocessing][${jobId}] Skipping video thumbnail due to quota exceeded: ${error.message}`,
      );
      return true;
    }
    logger.error(
      `[assetPreprocessing][${jobId}] Failed to process video thumbnail: ${error}`,
    );
    return false;
  } finally {
    await fs
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

async function extractAndSaveImageText(
  jobId: string,
  asset: Buffer,
  contentType: string,
  bookmark: NonNullable<Awaited<ReturnType<typeof getBookmark>>>,
  isFixMode: boolean,
): Promise<boolean> {
  {
    const alreadyHasText = !!bookmark.asset.content;
    if (alreadyHasText && isFixMode) {
      logger.info(
        `[assetPreprocessing][${jobId}] Skipping image text extraction as it's already been extracted.`,
      );
      return false;
    }
  }
  let imageText = null;

  if (serverConfig.ocr.useLLM) {
    logger.info(
      `[assetPreprocessing][${jobId}] Attempting to extract text from image using LLM OCR.`,
    );
    try {
      imageText = await readImageTextWithLLM(asset, contentType);
    } catch (e) {
      logger.error(
        `[assetPreprocessing][${jobId}] Failed to read image text with LLM: ${e}`,
      );
    }
  } else {
    logger.info(
      `[assetPreprocessing][${jobId}] Attempting to extract text from image using Tesseract.`,
    );
    try {
      imageText = await readImageText(asset);
    } catch (e) {
      logger.error(
        `[assetPreprocessing][${jobId}] Failed to read image text: ${e}`,
      );
    }
  }

  if (!imageText) {
    return false;
  }

  logger.info(
    `[assetPreprocessing][${jobId}] Extracted ${imageText.length} characters from image.`,
  );
  await db
    .update(bookmarkAssets)
    .set({
      content: imageText,
      metadata: null,
    })
    .where(eq(bookmarkAssets.id, bookmark.id));
  return true;
}

async function extractAndSavePDFText(
  jobId: string,
  asset: Buffer,
  bookmark: NonNullable<Awaited<ReturnType<typeof getBookmark>>>,
  isFixMode: boolean,
): Promise<boolean> {
  {
    const alreadyHasText = !!bookmark.asset.content;
    if (alreadyHasText && isFixMode) {
      logger.info(
        `[assetPreprocessing][${jobId}] Skipping PDF text extraction as it's already been extracted.`,
      );
      return false;
    }
  }
  logger.info(
    `[assetPreprocessing][${jobId}] Attempting to extract text from pdf.`,
  );
  const pdfParse = await readPDFText(asset);
  if (!pdfParse?.text) {
    throw new Error(
      `[assetPreprocessing][${jobId}] PDF text is empty. Please make sure that the PDF includes text and not just images.`,
    );
  }
  logger.info(
    `[assetPreprocessing][${jobId}] Extracted ${pdfParse.text.length} characters from pdf.`,
  );
  await db
    .update(bookmarkAssets)
    .set({
      content: pdfParse.text,
      metadata: pdfParse.metadata ? JSON.stringify(pdfParse.metadata) : null,
    })
    .where(eq(bookmarkAssets.id, bookmark.id));
  return true;
}

async function getBookmark(bookmarkId: string) {
  return db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    with: {
      asset: true,
      assets: true,
    },
  });
}

async function run(req: DequeuedJob<AssetPreprocessingRequest>) {
  const isFixMode = req.data.fixMode;
  const jobId = req.id;
  const bookmarkId = req.data.bookmarkId;
  addLogFields<"assetPreprocessingWorker.run">({ "bookmark.id": bookmarkId });

  // A specific attachment to process (currently only video -> thumbnail),
  // as opposed to the bookmark's own primary asset (image/pdf uploads)
  // handled below.
  if (req.data.assetId) {
    await extractAndSaveVideoThumbnail(jobId, bookmarkId, req.data.assetId);
    return;
  }

  const bookmark = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    with: {
      asset: true,
      assets: true,
    },
  });

  logger.info(
    `[assetPreprocessing][${jobId}] Starting an asset preprocessing job for bookmark with id "${bookmarkId}"`,
  );

  if (!bookmark) {
    throw new Error(`[assetPreprocessing][${jobId}] Bookmark not found`);
  }

  if (!bookmark.asset) {
    throw new Error(
      `[assetPreprocessing][${jobId}] Bookmark is not an asset (not an image or pdf)`,
    );
  }

  const { asset, metadata } = await readAsset({
    userId: bookmark.userId,
    assetId: bookmark.asset.assetId,
  });

  if (!asset) {
    throw new Error(
      `[assetPreprocessing][${jobId}] AssetId ${bookmark.asset.assetId} for bookmark ${bookmarkId} not found`,
    );
  }

  addLogFields<"assetPreprocessingWorker.run">({
    "user.id": bookmark.userId,
    "asset.type": bookmark.asset.assetType,
    "asset.size": asset.length,
    "asset.content_type": metadata.contentType,
    "preprocessing.fix_mode": isFixMode,
  });

  let anythingChanged = false;
  switch (bookmark.asset.assetType) {
    case "image": {
      const extractedText = await extractAndSaveImageText(
        jobId,
        asset,
        metadata.contentType,
        bookmark,
        isFixMode,
      );
      anythingChanged ||= extractedText;
      break;
    }
    case "pdf": {
      const extractedText = await extractAndSavePDFText(
        jobId,
        asset,
        bookmark,
        isFixMode,
      );
      const extractedScreenshot = await extractAndSavePDFScreenshot(
        jobId,
        asset,
        bookmark,
        isFixMode,
      );
      anythingChanged ||= extractedText || extractedScreenshot;
      break;
    }
    default:
      throw new Error(
        `[assetPreprocessing][${jobId}] Unsupported bookmark type`,
      );
  }

  addLogFields<"assetPreprocessingWorker.run">({
    "preprocessing.changed": anythingChanged,
  });

  // Propagate priority to child jobs
  const enqueueOpts: EnqueueOptions = {
    priority: req.priority,
    groupId: bookmark.userId,
  };
  if (!isFixMode || anythingChanged) {
    if (serverConfig.embedding.enableAutoIndexing) {
      await EmbeddingsQueue.enqueue(
        {
          bookmarkId,
          type: "embed",
          runTaggingOnComplete: true,
        },
        enqueueOpts,
      );
    } else {
      await OpenAIQueue.enqueue(
        {
          bookmarkId,
          type: "tag",
        },
        enqueueOpts,
      );
    }
    await OpenAIQueue.enqueue(
      {
        bookmarkId,
        type: "summarize",
      },
      enqueueOpts,
    );

    // Update the search index
    await triggerSearchReindex(bookmarkId, enqueueOpts);
  }
}
