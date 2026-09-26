"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
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
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import type { ZListSubscription } from "@karakeep/shared/types/listSubscriptions";
import { useTRPC } from "@karakeep/shared-react/trpc";

import {
  isSyncing,
  pollWhileSyncing,
  SubscriptionStatus,
  useRefreshWhenSynced,
} from "./ListSubscriptionStatus";

const WHOLE_CAROUSEL_HINT =
  "Every picture of a post with several (and every page of a Pinterest idea pin), not just the first. Applies to posts that sync from now on; what's already in the list stays as it is.";
const NEAR_DUPLICATES_HINT =
  "A picture that's another copy of one you have (resized, re-saved, recropped: Settings → Pictures says how alike) is linked to that one instead of downloaded again.";

/** A subscription's option: whole carousels, skipping near-duplicates. */
function OptionCheckbox({
  checked,
  onChange,
  hint,
  className,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex w-fit cursor-pointer select-none items-center gap-2 text-muted-foreground",
        className,
      )}
      title={hint}
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
 * "Forget what it took": the next sync takes the whole source again, as if
 * the subscription were new — to take again what was deleted, say with other
 * settings. What you still have is filed again, never downloaded twice.
 */
function ForgetWhatItTook({
  subscription,
  onForgotten,
}: {
  subscription: ZListSubscription;
  onForgotten: () => void;
}) {
  const api = useTRPC();
  const { mutate: forget, isPending } = useMutation(
    api.listSubscriptions.forget.mutationOptions({
      onSuccess: ({ forgotten }) => {
        const what = `${forgotten.toLocaleString()} ${forgotten === 1 ? "picture" : "pictures"}`;
        toast({
          description: subscription.enabled
            ? `Forgot ${what}; syncing again.`
            : `Forgot ${what}; it syncs again when you resume it.`,
        });
        onForgotten();
      },
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const source = subscription.kind === "instagram" ? "collection" : "board";
  return (
    <ActionConfirmingDialog
      title="Forget what it took?"
      description={
        <p className="text-sm text-muted-foreground">
          {subscription.enabled ? "Right away" : "When you resume it"}, it goes
          through the whole {source} again as if it were new, with its current
          settings. Pictures you deleted are downloaded again; ones you still
          have are put back in this list, not copied.
        </p>
      }
      actionButton={(setDialogOpen) => (
        <ActionButton
          loading={isPending}
          onClick={() =>
            forget(
              { subscriptionId: subscription.id },
              { onSuccess: () => setDialogOpen(false) },
            )
          }
        >
          Forget
        </ActionButton>
      )}
    >
      <button
        type="button"
        disabled={isSyncing(subscription)}
        title="Take the whole source again, as if the subscription were new"
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <RotateCcw className="size-3" />
        Forget what it took
      </button>
    </ActionConfirmingDialog>
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
  const [skipNearDuplicates, setSkipNearDuplicates] = useState(false);

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
              add({
                listId,
                url: url.trim(),
                wholeCarousel,
                skipNearDuplicates,
              });
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
          <OptionCheckbox
            checked={wholeCarousel}
            onChange={setWholeCarousel}
            hint={WHOLE_CAROUSEL_HINT}
            className="text-sm"
          >
            Whole carousels: every picture of a post, not just the first
          </OptionCheckbox>
          <OptionCheckbox
            checked={skipNearDuplicates}
            onChange={setSkipNearDuplicates}
            hint={NEAR_DUPLICATES_HINT}
            className="text-sm"
          >
            Skip near-duplicates of pictures you have
          </OptionCheckbox>
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
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <OptionCheckbox
                    checked={subscription.wholeCarousel}
                    onChange={(checked) =>
                      update({
                        subscriptionId: subscription.id,
                        wholeCarousel: checked,
                      })
                    }
                    hint={WHOLE_CAROUSEL_HINT}
                    className="text-xs"
                  >
                    Whole carousels
                  </OptionCheckbox>
                  <OptionCheckbox
                    checked={subscription.skipNearDuplicates}
                    onChange={(checked) =>
                      update({
                        subscriptionId: subscription.id,
                        skipNearDuplicates: checked,
                      })
                    }
                    hint={NEAR_DUPLICATES_HINT}
                    className="text-xs"
                  >
                    Skip near-duplicates
                  </OptionCheckbox>
                  <ForgetWhatItTook
                    subscription={subscription}
                    onForgotten={() => void invalidate()}
                  />
                </div>
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
