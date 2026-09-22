"use client";

import { useEffect, useRef } from "react";
import RelativeTime from "@/components/ui/relative-time";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import type { ZListSubscription } from "@karakeep/shared/types/listSubscriptions";
import { useTRPC } from "@karakeep/shared-react/trpc";

/** Fork: shared by the list's subscriptions modal and the settings page. */

export function isSyncing(subscription: ZListSubscription) {
  return subscription.enabled && subscription.lastStatus === "pending";
}

/** How often to look again while a sync is running. */
export function pollWhileSyncing(query: {
  state: { data?: { subscriptions: ZListSubscription[] } };
}) {
  return query.state.data?.subscriptions.some(isSyncing) ? 2000 : false;
}

/** When a sync finishes, show what it brought in. */
export function useRefreshWhenSynced(
  subscriptions: ZListSubscription[] | undefined,
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const syncing = useRef(new Set<string>());

  useEffect(() => {
    const now = new Set(subscriptions?.filter(isSyncing).map((s) => s.id));
    const finished = [...syncing.current].some((id) => !now.has(id));
    syncing.current = now;
    if (finished) {
      void queryClient.invalidateQueries(
        api.bookmarks.getBookmarks.pathFilter(),
      );
      void queryClient.invalidateQueries(api.lists.stats.pathFilter());
    }
  }, [subscriptions, api, queryClient]);
}

export function SubscriptionStatus({
  subscription,
}: {
  subscription: ZListSubscription;
}) {
  if (!subscription.enabled) {
    return <span className="text-muted-foreground">Paused</span>;
  }
  if (subscription.lastStatus === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Syncing…
      </span>
    );
  }
  if (!subscription.lastRunAt) {
    return <span className="text-muted-foreground">Not synced yet</span>;
  }
  if (subscription.lastStatus === "failure") {
    return (
      <span className="text-destructive" title={subscription.lastError ?? ""}>
        Failed <RelativeTime date={subscription.lastRunAt} />
        {subscription.lastError ? `: ${subscription.lastError}` : ""}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      Synced <RelativeTime date={subscription.lastRunAt} />
      {subscription.lastImportedCount
        ? `, ${subscription.lastImportedCount} new`
        : ""}
    </span>
  );
}
