"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import {
  isSyncing,
  pollWhileSyncing,
  SubscriptionStatus,
  useRefreshWhenSynced,
} from "./ListSubscriptionStatus";

/**
 * Every picture of a carousel post (and every page of a Pinterest idea pin),
 * or only the first. A change applies to the posts that sync from then on.
 */
function WholeCarouselCheckbox({
  checked,
  onChange,
  className,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex w-fit cursor-pointer select-none items-center gap-2 text-muted-foreground",
        className,
      )}
      title="Every picture of a post with several (and every page of a Pinterest idea pin), not just the first. Applies to posts that sync from now on; what's already in the list stays as it is."
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 shrink-0 cursor-pointer accent-primary"
      />
      {children}
    </label>
  );
}

/**
 * A list's subscriptions: sources a worker keeps it in sync with — a public
 * Pinterest board, or one of your Instagram saved collections (with Instagram
 * connected in Settings). Paste the link and the worker fetches its pictures
 * and videos into this list, never taking the same one twice.
 * See apps/workers/workers/subscriptionWorker.ts.
 */
export function ListSubscriptionsModal({
  listId,
  open,
  setOpen,
}: {
  listId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [wholeCarousel, setWholeCarousel] = useState(true);

  const subscriptionsQuery = api.listSubscriptions.list.queryOptions({
    listId,
  });
  const { data } = useQuery({
    ...subscriptionsQuery,
    enabled: open,
    refetchInterval: pollWhileSyncing,
  });
  const subscriptions = data?.subscriptions ?? [];
  useRefreshWhenSynced(data?.subscriptions);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: subscriptionsQuery.queryKey });
  const onError = (e: { message: string }) =>
    toast({ variant: "destructive", description: e.message });

  const { mutate: add, isPending: isAdding } = useMutation(
    api.listSubscriptions.create.mutationOptions({
      onSuccess: () => {
        setUrl("");
        void invalidate();
      },
      onError,
    }),
  );
  const { mutate: remove } = useMutation(
    api.listSubscriptions.delete.mutationOptions({
      onSuccess: () => void invalidate(),
      onError,
    }),
  );
  const { mutate: update } = useMutation(
    api.listSubscriptions.update.mutationOptions({
      onSuccess: () => void invalidate(),
      onError,
    }),
  );
  const { mutate: syncNow, isPending: isQueueing } = useMutation(
    api.listSubscriptions.runNow.mutationOptions({
      onSuccess: () => void invalidate(),
      onError,
    }),
  );

  const anyEnabled = subscriptions.some((s) => s.enabled);
  const { data: instagram } = useQuery({
    ...api.instagram.status.queryOptions(),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Subscriptions</DialogTitle>
          <DialogDescription>
            Keep this list in sync with a public Pinterest board or one of your
            Instagram saved collections. Their pictures and videos are fetched
            on a schedule (Settings → List subscriptions), and nothing is ever
            saved twice. Changing “Whole carousels” applies to the posts that
            sync from then on.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) {
              add({ listId, url: url.trim(), wholeCarousel });
            }
          }}
        >
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Pinterest board or Instagram collection link"
              aria-label="Pinterest board or Instagram collection link"
              className="bg-muted"
            />
            <ActionButton
              type="submit"
              loading={isAdding}
              disabled={!url.trim()}
            >
              Add
            </ActionButton>
          </div>
          <WholeCarouselCheckbox
            checked={wholeCarousel}
            onChange={setWholeCarousel}
            className="text-sm"
          >
            Whole carousels: every picture of a post, not just the first
          </WholeCarouselCheckbox>
        </form>

        {instagram && instagram.status !== "ok" && (
          <p className="-mt-2 text-xs text-muted-foreground">
            For Instagram collections,{" "}
            <Link
              href="/settings/list-subscriptions"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {instagram.connected
                ? "paste a fresh Instagram session"
                : "connect Instagram"}
            </Link>{" "}
            first.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {subscriptions.map((subscription) => (
            <li
              key={subscription.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <a
                  href={subscription.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm hover:underline"
                  title={subscription.url}
                >
                  {subscription.name ?? subscription.url}
                </a>
                <span className="truncate text-xs">
                  <span className="text-muted-foreground">
                    {subscription.kind === "instagram"
                      ? "Instagram · "
                      : "Pinterest · "}
                  </span>
                  <SubscriptionStatus subscription={subscription} />
                </span>
                <WholeCarouselCheckbox
                  checked={subscription.wholeCarousel}
                  onChange={(checked) =>
                    update({
                      subscriptionId: subscription.id,
                      wholeCarousel: checked,
                    })
                  }
                  className="mt-1 text-xs"
                >
                  Whole carousels
                </WholeCarouselCheckbox>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      subscriptionId: subscription.id,
                      enabled: !subscription.enabled,
                    })
                  }
                >
                  {subscription.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  variant="ghost"
                  size="none"
                  className="p-2 text-destructive"
                  title="Remove the subscription (the pictures stay)"
                  aria-label="Remove subscription"
                  onClick={() => remove({ subscriptionId: subscription.id })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
          {subscriptions.length === 0 && (
            <li className="py-4 text-center text-sm text-muted-foreground">
              No subscriptions yet.
            </li>
          )}
        </ul>

        <DialogFooter className="sm:justify-between">
          <ActionButton
            variant="outline"
            loading={isQueueing}
            disabled={!anyEnabled || subscriptions.some(isSyncing)}
            onClick={() => syncNow({ listId })}
          >
            <RefreshCw className="mr-2 size-4" />
            Sync now
          </ActionButton>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
