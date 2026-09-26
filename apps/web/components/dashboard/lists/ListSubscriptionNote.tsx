"use client";

import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeI18nLanguage } from "@/lib/date-format";
import { useTranslation } from "@/lib/i18n/client";
import { useUserSettings } from "@/lib/userSettings";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";

import type { ZListSubscription } from "@karakeep/shared/types/listSubscriptions";
import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { nextSubscriptionSyncAt } from "@karakeep/shared/utils/listSubscriptions";

import { ListSubscriptionsModal } from "./ListSubscriptionsModal";
import {
  isSyncing,
  pollWhileSyncing,
  SubscriptionStatus,
  useRefreshWhenSynced,
} from "./ListSubscriptionStatus";

/**
 * Fork: under a list's name, that it syncs from a Pinterest board or an
 * Instagram collection. Hovering says when each one syncs next; clicking
 * opens the list's subscriptions.
 */

const SOURCE = {
  pinterest: { name: "Pinterest", several: "Pinterest boards" },
  instagram: { name: "Instagram", several: "Instagram collections" },
} as const;

function sourcesLabel(subscriptions: ZListSubscription[]) {
  const kinds = [...new Set(subscriptions.map((s) => s.kind))];
  if (kinds.length > 1) {
    return `Syncs from ${kinds.map((k) => SOURCE[k].name).join(" and ")}`;
  }
  const source = SOURCE[kinds[0]];
  return subscriptions.length === 1
    ? `Syncs from ${source.name}`
    : `Syncs from ${subscriptions.length} ${source.several}`;
}

/** "14:00" today, "Sat 14:00" this week, a date and time after that. */
function clockTime(date: Date, language: string | undefined) {
  const days = (date.getTime() - Date.now()) / (24 * 3600_000);
  const options: Intl.DateTimeFormatOptions =
    date.toDateString() === new Date().toDateString()
      ? { timeStyle: "short" }
      : days < 6
        ? { weekday: "short", hour: "numeric", minute: "2-digit" }
        : { dateStyle: "medium", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(
      normalizeI18nLanguage(language),
      options,
    ).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/** When it syncs next. Worked out when the tooltip opens, so it's current. */
function NextSync({
  subscription,
  intervalHours,
}: {
  subscription: ZListSubscription;
  intervalHours: number;
}) {
  const { i18n } = useTranslation();
  if (!subscription.enabled) {
    return <>Paused</>;
  }
  if (isSyncing(subscription)) {
    return <>Syncing now…</>;
  }
  const next = nextSubscriptionSyncAt(subscription.lastRunAt, intervalHours);
  if (!next) {
    return <>Syncs only when you press “Sync now”</>;
  }
  return (
    <>
      Next sync {formatDistanceToNow(next, { addSuffix: true })}, at{" "}
      {clockTime(next, i18n.language)}
    </>
  );
}

export function ListSubscriptionNote({ list }: { list: ZBookmarkList }) {
  const api = useTRPC();
  const { subscriptionIntervalHours } = useUserSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const { data } = useQuery({
    ...api.listSubscriptions.list.queryOptions({ listId: list.id }),
    // Only a list you fill yourself takes subscriptions.
    enabled: list.type === "manual",
    refetchInterval: pollWhileSyncing,
  });
  const subscriptions = data?.subscriptions ?? [];
  // A sync that finishes while the list is open shows what it brought in.
  useRefreshWhenSynced(data?.subscriptions);

  if (subscriptions.length === 0) {
    return null;
  }
  const canEdit = list.userRole === "owner" || list.userRole === "editor";
  const syncing = subscriptions.some(isSyncing);
  const paused = subscriptions.every((s) => !s.enabled);

  return (
    <>
      <span aria-hidden>·</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={
              canEdit
                ? "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground"
                : "inline-flex cursor-help items-center gap-1 whitespace-nowrap"
            }
            onClick={() => canEdit && setModalOpen(true)}
          >
            {syncing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {syncing
              ? "Syncing…"
              : paused
                ? `${sourcesLabel(subscriptions)} (paused)`
                : sourcesLabel(subscriptions)}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm">
          <ul className="flex flex-col gap-2 py-0.5">
            {subscriptions.map((subscription) => (
              <li key={subscription.id} className="flex flex-col">
                <span className="truncate font-medium">
                  {subscription.name ?? subscription.url}
                  <span className="font-normal text-muted-foreground">
                    {` · ${SOURCE[subscription.kind].name}`}
                  </span>
                </span>
                <span>
                  <NextSync
                    subscription={subscription}
                    intervalHours={subscriptionIntervalHours}
                  />
                </span>
                {subscription.enabled && !isSyncing(subscription) && (
                  <span className="text-xs">
                    <SubscriptionStatus subscription={subscription} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
      {canEdit && (
        <ListSubscriptionsModal
          listId={list.id}
          open={modalOpen}
          setOpen={setModalOpen}
        />
      )}
    </>
  );
}
