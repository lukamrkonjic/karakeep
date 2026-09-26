import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchWithProxy } from "network";

import type { ModelFile } from "@karakeep/shared-server";
import {
  CLIP_FILES,
  CLIP_MODEL_ID,
  CLIP_MODEL_REVISION,
  clipFilePath,
  hasClipFile,
} from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";

import type { TokenizerJson } from "./tokenizer";
import { ClipTokenizer, CONTEXT_LENGTH } from "./tokenizer";

/**
 * Fork: the picture model — Immich's default CLIP model, OpenAI's ViT-B/32,
 * exported the way Immich publishes it for its own smart search and
 * duplicates — run on the CPU. Its picture half turns a picture into 512
 * numbers (its fingerprint, an embedding); its text half turns a
 * description into 512 numbers pointing the same way as pictures of it. Two
 * pictures whose embeddings point the same way show the same thing, even
 * resized, recompressed, cropped or filtered.
 *
 * The files (0.35 GB for pictures, 0.25 GB for text) are downloaded once,
 * each when first needed, into the data folder (shared-server's
 * pictureModels.ts says where).
 */

// visual/preprocess_cfg.json: the shortest side to 224 px (bicubic), the
// middle square, then OpenAI's per-channel mean and spread.
const SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

// Leaves the NAS's other cores to everything else.
const THREADS = 2;

async function download(file: ModelFile, signal?: AbortSignal) {
  const target = clipFilePath(file);
  const url = `https://huggingface.co/${CLIP_MODEL_ID}/resolve/${CLIP_MODEL_REVISION}/${file.repoPath}`;
  logger.info(
    `[pictures] Downloading ${file.repoPath} of the picture model (${Math.round(file.size / 1e6)} MB, once) from ${url}`,
  );
  const resp = await fetchWithProxy(url, { signal });
  if (!resp.ok || !resp.body) {
    throw new Error(
      `Couldn't download the picture model's ${file.repoPath}: HTTP ${resp.status}`,
    );
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  const hash = createHash("sha256");
  try {
    await pipeline(
      resp.body,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(part),
    );
    if (hash.digest("hex") !== file.sha256) {
      throw new Error(`The downloaded ${file.repoPath} is damaged`);
    }
    await fs.rename(part, target);
  } catch (error) {
    await fs.rm(part, { force: true });
    throw error;
  }
}

/** The file's path, downloading it first if this server hasn't yet. */
async function ensureFile(file: ModelFile, signal?: AbortSignal) {
  if (!(await hasClipFile(file))) {
    await download(file, signal);
  }
  return clipFilePath(file);
}

/**
 * The picture as the model takes it (3 × 224 × 224 numbers), and its size as
 * shown.
 */
export async function clipInput(
  image: Buffer,
): Promise<{ input: Float32Array; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(image, { failOn: "none" }).metadata();
  // EXIF orientations 5–8 turn the picture on its side.
  const turned = (meta.orientation ?? 1) >= 5;
  const { data, info } = await sharp(image, { failOn: "none" })
    .rotate() // as the picture is shown (EXIF orientation)
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .resize(SIZE, SIZE, {
      fit: "cover",
      position: "centre",
      kernel: "cubic",
      // JPEG and WebP shrink roughly while decoding by default, which makes
      // two sizes of one picture look different to the model (a lossless
      // copy of a WebP scored up to 0.05); decoding in full scores it 0.
      fastShrinkOnLoad: false,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) {
    throw new Error(`Unexpected ${info.channels}-channel picture`);
  }
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      input[c * plane + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return {
    input,
    width: (turned ? meta.height : meta.width) ?? 0,
    height: (turned ? meta.width : meta.height) ?? 0,
  };
}

export interface PictureModel {
  /** The picture's embedding (scaled to length 1), and its size as shown. */
  embed(
    image: Buffer,
  ): Promise<{ vector: Float32Array; width: number; height: number }>;
  /** Frees the model's memory (about 0.5 GB). */
  close(): Promise<void>;
}

export interface TextModel {
  /** The description's embedding (scaled to length 1). */
  embed(text: string): Promise<Float32Array>;
  /** Frees the model's memory (about 0.4 GB). */
  close(): Promise<void>;
}

async function openSession(file: string) {
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(file, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    intraOpNumThreads: THREADS,
  });
  return { ort, session };
}

/** Loads the picture half, downloading it first if needed. */
export async function openPictureModel(
  signal?: AbortSignal,
): Promise<PictureModel> {
  const { ort, session } = await openSession(
    await ensureFile(CLIP_FILES.picture, signal),
  );
  const [inputName] = session.inputNames;
  const [outputName] = session.outputNames;
  return {
    async embed(image) {
      const { input, width, height } = await clipInput(image);
      const result = await session.run({
        [inputName]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]),
      });
      const vector = normalized(result[outputName].data as Float32Array);
      return { vector, width, height };
    },
    close: () => session.release(),
  };
}

/** Loads the text half and its tokenizer, downloading them first if needed. */
export async function openTextModel(signal?: AbortSignal): Promise<TextModel> {
  const tokenizerFile = await ensureFile(CLIP_FILES.tokenizer, signal);
  const tokenizer = ClipTokenizer.fromJson(
    JSON.parse(await fs.readFile(tokenizerFile, "utf8")) as TokenizerJson,
  );
  const { ort, session } = await openSession(
    await ensureFile(CLIP_FILES.text, signal),
  );
  const [inputName] = session.inputNames;
  const [outputName] = session.outputNames;
  return {
    async embed(text) {
      const result = await session.run({
        [inputName]: new ort.Tensor("int32", tokenizer.encode(text), [
          1,
          CONTEXT_LENGTH,
        ]),
      });
      return normalized(result[outputName].data as Float32Array);
    },
    close: () => session.release(),
  };
}

function normalized(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vector) {
    sum += v * v;
  }
  const length = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (v) => v / length);
}
