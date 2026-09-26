import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import serverConfig from "@karakeep/shared/config";

/**
 * Fork: the picture model's files — Immich's default CLIP model (OpenAI's
 * ViT-B/32, exported the way Immich publishes it), downloaded once into the
 * data folder by the workers (apps/workers/workers/pictures/clip.ts). Its
 * picture half gives pictures their fingerprints; its text half turns a
 * description into one, for search by description.
 */

export const CLIP_MODEL_ID = "immich-app/ViT-B-32__openai";
export const CLIP_MODEL_REVISION = "a857c8de2c07bbcfa6646adfcf31b798845afa1e";

export interface ModelFile {
  /** Where it is in the model's repository. */
  repoPath: string;
  /** Where it is kept, under the model's folder in the data folder. */
  localPath: string;
  size: number;
  sha256: string;
}

export const CLIP_FILES = {
  picture: {
    repoPath: "visual/model.onnx",
    // Where the duplicates job has always kept it.
    localPath: "model.onnx",
    size: 351_613_724,
    sha256: "33a3df41ceef21acdf371af00f6dd0456ec1f9eba24d03a7720f9c3734e40859",
  },
  text: {
    repoPath: "textual/model.onnx",
    localPath: "textual/model.onnx",
    size: 254_193_396,
    sha256: "b80cf0af751533a6712d92247f0ddc0c95208748bc59a1a27f33e67be6864e3b",
  },
  tokenizer: {
    repoPath: "textual/tokenizer.json",
    localPath: "textual/tokenizer.json",
    size: 3_642_073,
    sha256: "6d9109cc838977f3ca94a379eec36aecc7c807e1785cd729660ca2fc0171fb35",
  },
} as const satisfies Record<string, ModelFile>;

export function clipFilePath(file: ModelFile): string {
  return path.join(
    serverConfig.dataDir,
    "models",
    CLIP_MODEL_ID.replace("/", "__"),
    CLIP_MODEL_REVISION.slice(0, 12),
    file.localPath,
  );
}

/** Whether a file is downloaded (in full: a download writes to a .part). */
export async function hasClipFile(file: ModelFile): Promise<boolean> {
  const stat = await fs.stat(clipFilePath(file)).catch(() => null);
  return stat?.size === file.size;
}

/** Whether a half of the model is ready to use. */
export async function clipModelDownloaded(
  half: "picture" | "text",
): Promise<boolean> {
  if (half === "picture") {
    return hasClipFile(CLIP_FILES.picture);
  }
  return (
    (await hasClipFile(CLIP_FILES.text)) &&
    (await hasClipFile(CLIP_FILES.tokenizer))
  );
}

/** A description as it's searched by: the model reads it in lower case. */
export function normalizeDescription(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** The cache key of a description's fingerprint (pictureTextQueries). */
export function pictureTextQueryId(description: string): string {
  return createHash("sha256")
    .update(`${CLIP_MODEL_ID}@${CLIP_MODEL_REVISION}\n${description}`)
    .digest("hex")
    .slice(0, 32);
}
