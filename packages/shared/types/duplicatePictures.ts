import { z } from "zod";

/**
 * Fork: duplicate pictures (Cleanups → Duplicate pictures). How alike two
 * pictures must be, as the picture model's distance (Immich's cosine
 * distance: 0 = the same picture). Measured on real photos: a resized or
 * mirrored copy scores about 0.01–0.03, a recropped or recompressed one about
 * 0.05, and two different photos of the same kind of scene 0.10 and up.
 */
export const DUPLICATE_MATCH_LEVELS = {
  // A resized, re-saved or mirrored copy.
  identical: 0.02,
  // Also recompressed, recropped or lightly edited copies.
  near: 0.06,
  // Also heavier crops and edits — and now and then two shots of one scene.
  similar: 0.1,
} as const;
export type DuplicateMatchLevel = keyof typeof DUPLICATE_MATCH_LEVELS;
export const zDuplicateMatchLevelSchema = z.enum([
  "identical",
  "near",
  "similar",
]);
export const DEFAULT_DUPLICATE_MATCH_LEVEL: DuplicateMatchLevel = "near";

/** The loosest level: what the worker records. */
export const MAX_DUPLICATE_DISTANCE = DUPLICATE_MATCH_LEVELS.similar;

export const zDuplicatePicturesStatusSchema = z.object({
  // "never": no check has run for this user yet. "waiting": for the
  // fingerprints job to look at the new pictures first.
  status: z.enum(["never", "waiting", "pending", "running", "done", "failed"]),
  checkedAt: z.date().nullable(),
  error: z.string().nullable(),
  // Pictures the model has looked at, of all the user's pictures.
  checked: z.number(),
  total: z.number(),
});
export type ZDuplicatePicturesStatus = z.infer<
  typeof zDuplicatePicturesStatusSchema
>;

export const zDuplicatePictureSchema = z.object({
  bookmarkId: z.string(),
  title: z.string().nullable(),
  createdAt: z.date(),
  favourited: z.boolean(),
  archived: z.boolean(),
  kind: z.enum(["image", "video"]),
  // What to show: the picture, or a video's first frame.
  imageAssetId: z.string(),
  contentType: z.string().nullable(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  sourceUrl: z.string().nullable(),
  lists: z.array(
    z.object({ id: z.string(), name: z.string(), icon: z.string() }),
  ),
});
export type ZDuplicatePicture = z.infer<typeof zDuplicatePictureSchema>;

export const zDuplicateGroupSchema = z.object({
  // How alike the least alike pair in the group is.
  distance: z.number(),
  pictures: z.array(zDuplicatePictureSchema),
});
export type ZDuplicateGroup = z.infer<typeof zDuplicateGroupSchema>;

/**
 * The one to keep when a group is resolved in bulk: the most pixels, then
 * the biggest file, then the first saved.
 */
export function bestDuplicate<
  T extends {
    width: number | null;
    height: number | null;
    size: number;
    createdAt: Date;
  },
>(pictures: T[]): T {
  return [...pictures].sort(
    (a, b) =>
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
      b.size - a.size ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}
