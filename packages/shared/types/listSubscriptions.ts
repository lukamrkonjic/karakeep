import { z } from "zod";

/**
 * Fork: a list subscription — a source (a public Pinterest board, or one of
 * your Instagram saved collections) that a worker keeps a list in sync with.
 */

export const zListSubscriptionKindSchema = z.enum(["pinterest", "instagram"]);
export type ZListSubscriptionKind = z.infer<typeof zListSubscriptionKindSchema>;

export const zListSubscriptionSchema = z.object({
  id: z.string(),
  listId: z.string(),
  kind: zListSubscriptionKindSchema,
  url: z.string(),
  name: z.string().nullable(),
  enabled: z.boolean(),
  // Every picture of a carousel (and every page of a Pinterest idea pin),
  // not only the first. Applies to posts that come in from when it was
  // turned on.
  wholeCarousel: z.boolean(),
  createdAt: z.date(),
  lastRunAt: z.date().nullable(),
  // "pending" = a sync is queued or running.
  lastStatus: z.enum(["pending", "success", "failure"]).nullable(),
  lastError: z.string().nullable(),
  // What the last sync added to the list (downloaded or linked).
  lastImportedCount: z.number().nullable(),
});
export type ZListSubscription = z.infer<typeof zListSubscriptionSchema>;

export const zNewListSubscriptionSchema = z.object({
  listId: z.string(),
  url: z.string().min(1),
  wholeCarousel: z.boolean().default(true),
});

export const zUpdateListSubscriptionSchema = z.object({
  subscriptionId: z.string(),
  enabled: z.boolean().optional(),
  wholeCarousel: z.boolean().optional(),
});

/** Your Instagram connection (Settings → List subscriptions). */
export const zInstagramConnectionSchema = z.object({
  connected: z.boolean(),
  username: z.string().nullable(),
  // "expired": Instagram turned the session away; paste a fresh one.
  status: z.enum(["ok", "expired"]).nullable(),
  checkedAt: z.date().nullable(),
});
export type ZInstagramConnection = z.infer<typeof zInstagramConnectionSchema>;

/** How often subscriptions are synced, in hours. 0 means only when asked. */
export const SUBSCRIPTION_INTERVAL_CHOICES = [0, 3, 6, 12, 24, 168] as const;
