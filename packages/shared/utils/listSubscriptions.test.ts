import { describe, expect, test } from "vitest";

import { isSubscriptionDue, nextSubscriptionSyncAt } from "./listSubscriptions";

const at = (time: string) => new Date(`2026-09-26T${time}Z`);

describe("next subscription sync", () => {
  test("every 12 hours: the first hour at least 11 h 50 min after the last", () => {
    // Due from 20:17; the cron fires on the hour.
    expect(nextSubscriptionSyncAt(at("08:27:00"), 12, +at("09:30:00"))).toEqual(
      at("21:00:00"),
    );
    // Due from 19:55, so already at 20:00 (the slack).
    expect(nextSubscriptionSyncAt(at("08:05:00"), 12, +at("09:30:00"))).toEqual(
      at("20:00:00"),
    );
  });

  test("never synced, or overdue: the next hour", () => {
    expect(nextSubscriptionSyncAt(null, 3, +at("09:30:00"))).toEqual(
      at("10:00:00"),
    );
    expect(nextSubscriptionSyncAt(at("01:00:00"), 3, +at("09:30:00"))).toEqual(
      at("10:00:00"),
    );
  });

  test("only when asked: none", () => {
    expect(nextSubscriptionSyncAt(at("08:00:00"), 0, +at("09:30:00"))).toBe(
      null,
    );
    expect(isSubscriptionDue(null, 0, +at("09:30:00"))).toBe(false);
  });

  test("the cron queues it at exactly that hour, not the one before", () => {
    const lastRunAt = at("08:27:00");
    const next = nextSubscriptionSyncAt(lastRunAt, 6, +at("09:30:00"));
    expect(next).toEqual(at("15:00:00"));
    expect(isSubscriptionDue(lastRunAt, 6, +next!)).toBe(true);
    expect(isSubscriptionDue(lastRunAt, 6, +next! - 3600_000)).toBe(false);
  });
});
