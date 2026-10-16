import { z } from "zod";

/**
 * Fork: guest links — someone without an account looks through the lists
 * ticked for a link, read-only (packages/trpc/routers/guestShares.ts, the web
 * app's /share/[token]).
 */

export const MAX_GUEST_SHARE_NAME_LENGTH = 100;

/** A guest link, as its owner sees it. */
export const zGuestShareSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  showNotes: z.boolean(),
  listIds: z.array(z.string()),
  createdAt: z.date(),
});
export type ZGuestShare = z.infer<typeof zGuestShareSchema>;

export const zUpdateGuestShareSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(MAX_GUEST_SHARE_NAME_LENGTH).optional(),
  showNotes: z.boolean().optional(),
  listIds: z.array(z.string()).max(2000).optional(),
});

/**
 * A list a guest sees. `parentId` only when the list it's in is shown too,
 * so the guest's tree is made of what's shared.
 */
export const zGuestShareListSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  description: z.string().nullish(),
  parentId: z.string().nullable(),
  numItems: z.number(),
});
export type ZGuestShareList = z.infer<typeof zGuestShareListSchema>;

/** What a guest link shows, as the guest sees it. */
export const zGuestShareViewSchema = z.object({
  ownerName: z.string(),
  showNotes: z.boolean(),
  lists: z.array(zGuestShareListSchema),
  /** Everything shown, each bookmark once. */
  numItems: z.number(),
});
export type ZGuestShareView = z.infer<typeof zGuestShareViewSchema>;
