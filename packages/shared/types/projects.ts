import { z } from "zod";

/**
 * Fork: projects — boards to lay pictures out on, apart from the lists, as
 * Pinterest keeps boards (routers/projects.ts). A project holds pictures of
 * yours (any bookmark; it's never moved or copied, only shown) and notes,
 * each where it was put on the board: its box in the board's own units, a
 * board pixel at 100% zoom.
 */

export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500;
/** What one board holds at most: pictures and notes together. */
export const MAX_PROJECT_ITEMS = 2000;
export const MAX_PROJECT_NOTE_LENGTH = 5000;

/** A note's type size: s, m, l, xl (board pixels 16, 24, 40, 64). */
export const PROJECT_NOTE_SIZES = ["s", "m", "l", "xl"] as const;
/**
 * A note's look: "none" is words straight on the board (a heading, a
 * label); the rest are cards — paper, or a sticky note's colour.
 */
export const PROJECT_NOTE_COLOURS = [
  "none",
  "paper",
  "yellow",
  "rose",
  "sky",
  "mint",
  "lilac",
] as const;

export const zProjectNoteStyleSchema = z.object({
  size: z.enum(PROJECT_NOTE_SIZES),
  colour: z.enum(PROJECT_NOTE_COLOURS),
});
export type ZProjectNoteStyle = z.infer<typeof zProjectNoteStyleSchema>;

const zName = z
  .string()
  .trim()
  .min(1, "Give the project a name")
  .max(
    MAX_PROJECT_NAME_LENGTH,
    `A project's name is at most ${MAX_PROJECT_NAME_LENGTH} characters`,
  );
const zDescription = z
  .string()
  .trim()
  .max(
    MAX_PROJECT_DESCRIPTION_LENGTH,
    `A description is at most ${MAX_PROJECT_DESCRIPTION_LENGTH} characters`,
  );

/** A place on the board (a coordinate), kept within reason. */
const zCoord = z.number().finite().min(-1_000_000).max(1_000_000);
/** A box's side: from a sliver to a wall. */
const zSide = z.number().finite().min(1).max(100_000);

export const zProjectItemSchema = z.object({
  /** Made by whoever adds it (the board, so it can undo), 1–64 chars. */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(["bookmark", "note"]),
  /** The picture's bookmark (kind "bookmark"); null for a note. */
  bookmarkId: z.string().max(64).nullable(),
  /** A note's words; null for a picture. */
  text: z.string().max(MAX_PROJECT_NOTE_LENGTH).nullable(),
  /** A note's look; null for a picture. */
  style: zProjectNoteStyleSchema.nullable(),
  x: zCoord,
  y: zCoord,
  w: zSide,
  h: zSide,
  /** Higher sits on top. */
  z: z.number().finite().min(-1e12).max(1e12),
});
export type ZProjectItem = z.infer<typeof zProjectItemSchema>;

/** A picture of the project's, for its cover (the biggest on the board). */
export const zProjectCoverSchema = z.object({
  assetId: z.string(),
  video: z.boolean(),
});
export type ZProjectCover = z.infer<typeof zProjectCoverSchema>;

export const zProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  /** Its last change, or its board's — the projects show newest first. */
  updatedAt: z.date(),
  /** Pictures on its board. */
  numPictures: z.number(),
  /** Notes on its board. */
  numNotes: z.number(),
  /** Up to three of its pictures, the biggest on the board first. */
  cover: z.array(zProjectCoverSchema),
});
export type ZProject = z.infer<typeof zProjectSchema>;

export const zNewProjectSchema = z.object({
  name: zName,
  description: zDescription.optional(),
});

export const zEditProjectSchema = z.object({
  projectId: z.string(),
  name: zName.optional(),
  description: zDescription.nullable().optional(),
});

/** A picture's size where the board already knows it (its width, height). */
export const zProjectPictureSizeSchema = z.object({
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
});

export const zAddToProjectSchema = z.object({
  projectId: z.string(),
  bookmarkIds: z.array(z.string()).min(1).max(500),
  /**
   * Where on the board they go, their middle (a drop, the middle of what's
   * on screen); without it, to the right of everything on it.
   */
  at: z.object({ x: zCoord, y: zCoord }).optional(),
  /** Sizes the client has seen (a picture it showed), by bookmark. */
  sizes: z.record(z.string(), zProjectPictureSizeSchema).optional(),
});

export const zSaveProjectItemsSchema = z.object({
  projectId: z.string(),
  /** Added or changed, whole. */
  upsert: z.array(zProjectItemSchema).max(MAX_PROJECT_ITEMS),
  /** Taken off the board, by item id. */
  remove: z.array(z.string().max(64)).max(MAX_PROJECT_ITEMS),
});
