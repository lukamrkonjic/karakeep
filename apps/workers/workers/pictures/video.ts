import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { createAssetReadStream } from "@karakeep/shared-server";

/**
 * Fork: what the picture jobs need of a video, cheaply, with ffmpeg (in the
 * image; the preprocessing worker uses it too): its length, and one frame — a
 * fifth of the way in, where its first-frame picture is taken
 * (assetPreprocessingWorker.ts), so the two fingerprint alike. Two videos
 * are the same when that frame and the length are (shared-server's
 * pictureVectors.ts `sameKind`): no frame-by-frame look.
 */

const run = promisify(execFile);

/** The video's length in seconds; 0 when it can't be read. */
export async function videoLength(file: string): Promise<number> {
  try {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { timeout: 30_000 },
    );
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    return 0;
  }
}

/**
 * One frame, a fifth of the way in (the first one when the length isn't
 * known, or the seek fails), as a JPEG — taken as the preprocessing worker
 * takes a video's first-frame picture.
 */
export async function videoFrame(
  file: string,
  length: number,
): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "karakeep-frame-"));
  const out = path.join(dir, "frame.jpg");
  const grab = (seek: string[]) =>
    run(
      "ffmpeg",
      [
        "-y",
        ...seek,
        "-i",
        file,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-q:v",
        "4",
        out,
      ],
      { timeout: 60_000 },
    );
  try {
    try {
      await grab(length > 0 ? ["-ss", (length * 0.2).toFixed(2)] : []);
    } catch (error) {
      if (length <= 0) {
        throw error;
      }
      await grab([]);
    }
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Runs `fn` with one of the user's assets in a file of its own. */
export async function withAssetFile<T>(
  userId: string,
  assetId: string,
  fn: (file: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "karakeep-asset-"));
  const file = path.join(dir, "asset");
  try {
    await pipeline(
      await createAssetReadStream({ userId, assetId }),
      createWriteStream(file),
    );
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
