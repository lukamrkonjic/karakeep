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
  DEFAULT_MAX_VIDEO_HEIGHT,
  VIDEO_HEIGHT_CHOICES,
} from "@karakeep/shared/types/listSubscriptions";
import { parseYouTubeList } from "@karakeep/shared/utils/youtube";

import {
  isSyncing,
  pollWhileSyncing,
  SubscriptionStatus,
  useRefreshWhenSynced,
} from "./ListSubscriptionStatus";

const WHOLE_CAROUSEL_HINT =
  "Every picture of a post with several (and every page of a Pinterest idea pin), not just the first. Applies to posts that sync from now on; what's already in the list stays as it is.";
const NEAR_DUPLICATES_HINT =
  "A picture that's another copy of one you have (resized, re-saved, recropped: Settings → Pictures says how alike) is linked to that one instead of downloaded again. A video too, when a frame of it and its length match one of yours.";
const QUALITY_HINT =
  "How sharp the videos are downloaded; each step down takes about half the space. Without a PO token provider on the server (Settings → List subscriptions), YouTube often gives out only 360p.";

/** What each kind of source is, in words. */
const SOURCE = {
  pinterest: { name: "Pinterest", source: "board", things: "pictures" },
  instagram: { name: "Instagram", source: "collection", things: "pictures" },
  youtube: { name: "YouTube", source: "playlist", things: "videos" },
} as const;

/** YouTube: the tallest video to download. */
function VideoQualitySelect({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (height: number) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex w-fit items-center gap-2 text-muted-foreground",
        className,
      )}
      title={QUALITY_HINT}
    >
      Quality
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cursor-pointer rounded-md border bg-background px-1.5 py-0.5 text-foreground"
      >
        {VIDEO_HEIGHT_CHOICES.map((height) => (
          <option key={height} value={height}>
            {height}p{height === 1080 ? " (Full HD)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

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
        const things = SOURCE[subscription.kind].things;
        const what = `${forgotten.toLocaleString()} ${forgotten === 1 ? things.slice(0, -1) : things}`;
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
  const { source, things } = SOURCE[subscription.kind];
  const Things = things.charAt(0).toUpperCase() + things.slice(1);
  return (
    <ActionConfirmingDialog
      title="Forget what it took?"
      description={
        <p className="text-sm text-muted-foreground">
          {subscription.enabled ? "Right away" : "When you resume it"}, it goes
          through the whole {source} again as if it were new, with its current
          settings. {Things} you deleted are downloaded again; ones you still
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
 * Pinterest board, one of your Instagram saved collections (with Instagram
 * connected in Settings), or a YouTube playlist or channel (its videos
 * downloaded, at the quality picked). Paste the link and the worker fetches
 * its pictures and videos into this list, never taking the same one twice.
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
  const [quality, setQuality] = useState<number>(DEFAULT_MAX_VIDEO_HEIGHT);
  // A YouTube link, as it's typed: its options, or why it won't do.
  const youtube = parseYouTubeList(url);
  const youtubeProblem =
    youtube && "problem" in youtube ? youtube.problem : null;

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
            Keep this list in sync with a public Pinterest board, one of your
            Instagram saved collections, or a YouTube playlist or channel. Their
            pictures and videos are fetched on a schedule (Settings → List
            subscriptions), and nothing is ever saved twice. Changing “Whole
            carousels” or the quality applies to what syncs from then on.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && !youtubeProblem) {
              add({
                listId,
                url: url.trim(),
                wholeCarousel,
                skipNearDuplicates,
                ...(youtube ? { maxVideoHeight: quality } : {}),
              });
            }
          }}
        >
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Pinterest board, Instagram collection or YouTube playlist link"
              aria-label="Pinterest board, Instagram collection or YouTube playlist link"
              className="bg-muted"
            />
            <ActionButton
              type="submit"
              loading={isAdding}
              disabled={!url.trim() || !!youtubeProblem}
            >
              Add
            </ActionButton>
          </div>
          {youtubeProblem && (
            <p className="text-sm text-destructive">{youtubeProblem}</p>
          )}
          {youtube && !youtubeProblem ? (
            <>
              <VideoQualitySelect
                value={quality}
                onChange={setQuality}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Every video in it is downloaded, a few at a time, and whatever
                is added to it later.
              </p>
            </>
          ) : (
            !youtubeProblem && (
              <OptionCheckbox
                checked={wholeCarousel}
                onChange={setWholeCarousel}
                hint={WHOLE_CAROUSEL_HINT}
                className="text-sm"
              >
                Whole carousels: every picture of a post, not just the first
              </OptionCheckbox>
            )
          )}
          {!youtubeProblem && (
            <OptionCheckbox
              checked={skipNearDuplicates}
              onChange={setSkipNearDuplicates}
              hint={NEAR_DUPLICATES_HINT}
              className="text-sm"
            >
              Skip near-duplicates of {youtube ? "videos" : "pictures"} you have
            </OptionCheckbox>
          )}
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
                    {SOURCE[subscription.kind].name} ·{" "}
                  </span>
                  <SubscriptionStatus subscription={subscription} />
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {subscription.kind === "youtube" ? (
                    <VideoQualitySelect
                      value={
                        subscription.maxVideoHeight ?? DEFAULT_MAX_VIDEO_HEIGHT
                      }
                      onChange={(height) =>
                        update({
                          subscriptionId: subscription.id,
                          maxVideoHeight: height,
                        })
                      }
                      className="text-xs"
                    />
                  ) : (
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
                  )}
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
                  title={`Remove the subscription (the ${SOURCE[subscription.kind].things} stay)`}
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
