import { z } from "zod";

import { zDuplicateMatchLevelSchema } from "./duplicatePictures";

/**
 * Fork: what vrana does with its picture model (Immich's CLIP). A job in the
 * workers gives every picture a fingerprint (an embedding); on those rest
 * similar pictures, search by description, list suggestions, duplicate
 * pictures, and near-duplicates skipped on import. Settings → Pictures.
 */

export const zFingerprintScheduleSchema = z.enum([
  "hourly",
  "nightly",
  "manual",
]);
export const zDuplicatesScheduleSchema = z.enum(["nightly", "manual"]);
export const zSimilarLevelSchema = z.enum(["close", "related", "loose"]);
export const zDescribeLevelSchema = z.enum(["strict", "balanced", "loose"]);
export const zSuggestionsLevelSchema = z.enum(["sure", "likely", "hunch"]);
export const zSuggestionsScopeSchema = z.enum(["new", "month", "all"]);

export const zPictureSettingsSchema = z.object({
  // When new pictures get their fingerprint.
  fingerprintSchedule: zFingerprintScheduleSchema,
  // "More like this": the Similar row and page.
  similarEnabled: z.boolean(),
  similarLevel: zSimilarLevelSchema,
  // Search → Pictures: pictures found by describing them.
  describeEnabled: z.boolean(),
  describeLevel: zDescribeLevelSchema,
  // "Belongs in…": a list suggested for new pictures.
  suggestionsEnabled: z.boolean(),
  suggestionsLevel: zSuggestionsLevelSchema,
  suggestionsScope: zSuggestionsScopeSchema,
  // Cleanups → Duplicate pictures.
  duplicatesSchedule: zDuplicatesScheduleSchema,
  // How alike a picture a subscription brings in must be to one you have,
  // for a subscription with "Skip near-duplicates" ticked to skip it.
  importDuplicateLevel: zDuplicateMatchLevelSchema,
});
export type ZPictureSettings = z.infer<typeof zPictureSettingsSchema>;

export const zUpdatePictureSettingsSchema = zPictureSettingsSchema.partial();

export const DEFAULT_PICTURE_SETTINGS: ZPictureSettings = {
  fingerprintSchedule: "hourly",
  similarEnabled: true,
  similarLevel: "related",
  describeEnabled: true,
  describeLevel: "balanced",
  suggestionsEnabled: true,
  suggestionsLevel: "likely",
  suggestionsScope: "new",
  duplicatesSchedule: "nightly",
  importDuplicateLevel: "near",
};

/**
 * "More like this": how far a picture may be, as the model's distance (0 =
 * the same picture; a duplicate is under 0.1, two different pictures of the
 * same kind of thing about 0.15–0.3).
 */
export const SIMILAR_LEVELS = {
  close: 0.15,
  related: 0.22,
  loose: 0.3,
} as const;

/**
 * Search by description: how well a picture must match the words, as the
 * model's similarity between a text and a picture (a good match is about
 * 0.25–0.35; unrelated ones stay under 0.2).
 */
export const DESCRIBE_LEVELS = {
  strict: 0.26,
  balanced: 0.23,
  loose: 0.2,
} as const;

/**
 * List suggestions: of a picture's closest matches that are in a list, the
 * share in one list (weighted by how close each is), and how many at least.
 */
export const SUGGESTION_LEVELS = {
  sure: { share: 0.6, count: 4 },
  likely: { share: 0.4, count: 3 },
  hunch: { share: 0.25, count: 2 },
} as const;

/** "month" looks back this far; "new" from when suggestions were turned on. */
export const SUGGESTIONS_MONTH_MS = 30 * 24 * 3600_000;

export const zPictureJobStatusSchema = z.object({
  // "waiting": for the fingerprints job to finish first.
  status: z.enum(["never", "waiting", "pending", "running", "done", "failed"]),
  finishedAt: z.date().nullable(),
  error: z.string().nullable(),
  // What the last run did, in a few words.
  detail: z.string().nullable(),
});
export type ZPictureJobStatus = z.infer<typeof zPictureJobStatusSchema>;

export const zPicturesStatusSchema = z.object({
  fingerprints: zPictureJobStatusSchema.extend({
    // Pictures with a fingerprint, of all the user's pictures (and videos
    // with a first frame).
    done: z.number(),
    total: z.number(),
  }),
  suggestions: zPictureJobStatusSchema.extend({
    open: z.number(),
  }),
  // Downloaded yet (once, into the data folder)?
  models: z.object({ picture: z.boolean(), text: z.boolean() }),
});
export type ZPicturesStatus = z.infer<typeof zPicturesStatusSchema>;

/** A picture as a thumbnail: its own file, or a video's first frame. */
export const zPictureThumbSchema = z.object({
  bookmarkId: z.string(),
  title: z.string().nullable(),
  kind: z.enum(["image", "video"]),
  imageAssetId: z.string(),
});
export type ZPictureThumb = z.infer<typeof zPictureThumbSchema>;

export const zSuggestedListSchema = z.object({
  // The suggestion's own id, to add or dismiss it by.
  id: z.string(),
  listId: z.string(),
  name: z.string(),
  icon: z.string(),
  score: z.number(),
});
export type ZSuggestedList = z.infer<typeof zSuggestedListSchema>;

/** Cleanups → List suggestions: the pictures suggested for one list. */
export const zSuggestionGroupSchema = z.object({
  list: z.object({ id: z.string(), name: z.string(), icon: z.string() }),
  pictures: z.array(
    zPictureThumbSchema.extend({ suggestionId: z.string(), score: z.number() }),
  ),
});
export type ZSuggestionGroup = z.infer<typeof zSuggestionGroupSchema>;
