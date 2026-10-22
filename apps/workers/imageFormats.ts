import { promises as fs } from "fs";

import { IMAGE_ASSET_TYPES } from "@karakeep/shared/assetdb";

/**
 * Fork: image formats beyond the ones every tool downstream reads.
 *
 * Karakeep keeps JPEG, PNG, GIF, WebP and AVIF as they are: every current
 * browser shows them. OCR (Tesseract) and the vision models behind AI tagging
 * don't all read AVIF, so they get a PNG copy made on the fly
 * (`imageForAnalysis`). Formats that can be decoded but that a browser can't
 * show (TIFF) are turned into PNG before they are stored
 * (`convertForStorage`). HEIC, JPEG XL and BMP can't be decoded by the
 * bundled libvips at all, so those stay unsupported.
 */

/** Read as they are by Tesseract and by the vision APIs AI tagging uses. */
const READ_EVERYWHERE = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Decodable, but not something a browser can show: stored as PNG. */
export const CONVERTIBLE_IMAGE_TYPES = new Set<string>(["image/tiff"]);

/** Every still-image type a download may bring that can end up stored. */
export const ACCEPTED_IMAGE_TYPES = new Set<string>([
  ...IMAGE_ASSET_TYPES,
  ...CONVERTIBLE_IMAGE_TYPES,
]);

// Loaded on first use: most jobs never need it.
async function loadSharp() {
  return (await import("sharp")).default;
}

/** The image as OCR and vision models can read it. */
export async function imageForAnalysis(
  image: Buffer,
  contentType: string,
): Promise<{ image: Buffer; contentType: string }> {
  if (READ_EVERYWHERE.has(contentType)) {
    return { image, contentType };
  }
  const sharp = await loadSharp();
  // Upright (EXIF orientation applied); for an animation, its first frame.
  const png = await sharp(image).rotate().png().toBuffer();
  return { image: png, contentType: "image/png" };
}

/** Writes a PNG of `inputPath` to `outputPath`; returns its size in bytes. */
export async function convertForStorage(
  inputPath: string,
  outputPath: string,
): Promise<number> {
  const sharp = await loadSharp();
  const info = await sharp(inputPath).rotate().png().toFile(outputPath);
  return info.size;
}

/**
 * What a downloaded file really is, by its bytes, for when the server's
 * Content-Type says nothing useful (`application/octet-stream`, `image/jpg`,
 * none at all). A picture any browser shows comes back as its own type; one
 * that can only be decoded (TIFF, SVG, HEIF) as `convert` — stored as a PNG
 * of it. Null when it's neither a picture nor a video we can keep.
 */
export async function identifyFile(
  filePath: string,
  kind: "image" | "video",
): Promise<{ contentType: string; convert: boolean } | null> {
  const head = Buffer.alloc(64);
  const handle = await fs.open(filePath, "r");
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  if (kind === "video") {
    if (head.toString("latin1", 4, 8) === "ftyp") {
      return { contentType: "video/mp4", convert: false };
    }
    if (head.readUInt32BE(0) === 0x1a45dfa3) {
      return {
        contentType: head.includes("webm", 0, "latin1")
          ? "video/webm"
          : "video/x-matroska",
        convert: false,
      };
    }
    return null;
  }
  const sharp = await loadSharp();
  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch {
    return null; // not something libvips can decode
  }
  const kept: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  const own =
    metadata.format === "heif" && metadata.compression === "av1"
      ? "image/avif"
      : kept[metadata.format ?? ""];
  return own && IMAGE_ASSET_TYPES.has(own)
    ? { contentType: own, convert: false }
    : { contentType: `image/${metadata.format ?? "unknown"}`, convert: true };
}
