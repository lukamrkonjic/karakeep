/**
 * Fork: when list subscriptions sync. The workers' hourly cron (on the hour)
 * queues every enabled subscription whose last sync is at least the user's
 * interval ago, less a few minutes' slack. The web app uses the same rule to
 * say when the next sync is.
 */

const HOUR_MS = 3600_000;

/**
 * A run that finished a few minutes past the hour still counts as due on the
 * hour it is next due, so "every 3 hours" doesn't drift to 4.
 */
export const SUBSCRIPTION_SCHEDULE_SLACK_MS = 10 * 60_000;

/** Whether the cron, firing at `now`, queues a subscription. */
export function isSubscriptionDue(
  lastRunAt: Date | null,
  intervalHours: number,
  now: number,
): boolean {
  if (intervalHours <= 0) {
    return false; // only when asked
  }
  return (
    !lastRunAt ||
    now - lastRunAt.getTime() >=
      intervalHours * HOUR_MS - SUBSCRIPTION_SCHEDULE_SLACK_MS
  );
}

/**
 * When the cron next queues a subscription, or null when it syncs only when
 * asked. The cron fires on the hour of the server's clock, the same instant
 * as on the hour here unless one of the two is in a half-hour time zone.
 */
export function nextSubscriptionSyncAt(
  lastRunAt: Date | null,
  intervalHours: number,
  now = Date.now(),
): Date | null {
  if (intervalHours <= 0) {
    return null;
  }
  const nextHour = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
  if (!lastRunAt) {
    return new Date(nextHour);
  }
  const dueFrom =
    lastRunAt.getTime() +
    intervalHours * HOUR_MS -
    SUBSCRIPTION_SCHEDULE_SLACK_MS;
  return new Date(Math.max(nextHour, Math.ceil(dueFrom / HOUR_MS) * HOUR_MS));
}
