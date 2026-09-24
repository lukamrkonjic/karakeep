import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchWithProxy } from "network";

import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";

/**
 * Fork: the picture model behind duplicate pictures. It is Immich's default
 * CLIP model — OpenAI's ViT-B/32, exported the way Immich publishes it for
 * its own duplicate detection — run on the CPU. It turns a picture into 512
 * numbers (an embedding); two pictures whose embeddings point the same way
 * show the same thing, even resized, recompressed, cropped or filtered.
 */

export const CLIP_MODEL_ID = "immich-app/ViT-B-32__openai";
const REVISION = "a857c8de2c07bbcfa6646adfcf31b798845afa1e";
const MODEL_FILE = {
  path: "visual/model.onnx",
  size: 351_613_724,
  sha256: "33a3df41ceef21acdf371af00f6dd0456ec1f9eba24d03a7720f9c3734e40859",
};

// visual/preprocess_cfg.json: the shortest side to 224 px (bicubic), the
// middle square, then OpenAI's per-channel mean and spread.
const SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

// Leaves the NAS's other cores to everything else running at night.
const THREADS = 2;

/** Where the model is kept: downloaded once, into the data folder. */
export function clipModelPath(): string {
  return path.join(
    serverConfig.dataDir,
    "models",
    CLIP_MODEL_ID.replace("/", "__"),
    REVISION.slice(0, 12),
    "model.onnx",
  );
}

async function hasModel(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);
  return stat?.size === MODEL_FILE.size;
}

async function downloadModel(file: string, signal?: AbortSignal) {
  const url = `https://huggingface.co/${CLIP_MODEL_ID}/resolve/${REVISION}/${MODEL_FILE.path}`;
  logger.info(
    `[duplicates] Downloading the picture model (${Math.round(MODEL_FILE.size / 1e6)} MB, once) from ${url}`,
  );
  const resp = await fetchWithProxy(url, { signal });
  if (!resp.ok || !resp.body) {
    throw new Error(`Couldn't download the picture model: HTTP ${resp.status}`);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
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
    if (hash.digest("hex") !== MODEL_FILE.sha256) {
      throw new Error("The downloaded picture model is damaged");
    }
    await fs.rename(part, file);
  } catch (error) {
    await fs.rm(part, { force: true });
    throw error;
  }
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

export interface ClipModel {
  /** The picture's embedding (scaled to length 1), and its size as shown. */
  embed(
    image: Buffer,
  ): Promise<{ vector: Float32Array; width: number; height: number }>;
  /** Frees the model's memory (about 0.5 GB). */
  close(): Promise<void>;
}

/** Loads the model, downloading it first if this server hasn't yet. */
export async function openClipModel(signal?: AbortSignal): Promise<ClipModel> {
  const file = clipModelPath();
  if (!(await hasModel(file))) {
    await downloadModel(file, signal);
  }
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(file, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    intraOpNumThreads: THREADS,
  });
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

function normalized(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vector) {
    sum += v * v;
  }
  const length = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (v) => v / length);
}
