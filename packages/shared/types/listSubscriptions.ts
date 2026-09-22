import { z } from "zod";

/**
 * Fork: a list subscription — a source (for now, a public Pinterest board)
 * that a worker keeps a list in sync with.
 */

export const zListSubscriptionKindSchema = z.enum(["pinterest"]);
export type ZListSubscriptionKind = z.infer<typeof zListSubscriptionKindSchema>;

export const zListSubscriptionSchema = z.object({
  id: z.string(),
  listId: z.string(),
  kind: zListSubscriptionKindSchema,
  url: z.string(),
  name: z.string().nullable(),
  enabled: z.boolean(),
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
});

export const zUpdateListSubscriptionSchema = z.object({
  subscriptionId: z.string(),
  enabled: z.boolean(),
});

/** How often subscriptions are synced, in hours. 0 means only when asked. */
export const SUBSCRIPTION_INTERVAL_CHOICES = [0, 3, 6, 12, 24, 168] as const;
