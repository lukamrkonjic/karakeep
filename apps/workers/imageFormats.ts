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
