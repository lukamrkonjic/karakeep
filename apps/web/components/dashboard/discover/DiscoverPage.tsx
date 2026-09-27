"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, RefreshCw, X } from "lucide-react";
import { toast as sonner } from "sonner";

import type {
  ZDiscoverItem,
  ZPictureJobStatus,
} from "@karakeep/shared/types/pictures";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { listNameFromPath } from "@karakeep/shared/utils/listUtils";

/**
 * Fork: Discover — new pictures from Pinterest, like the pins you saved,
 * the most like your pictures first (the workers find them:
 * apps/workers/workers/pictures/discoverWorker.ts). Keep saves one in the
 * list it's suggested for, or another; Skip puts it away, and the waiting
 * ones like it with it.
 */

function busy(status: ZPictureJobStatus["status"]) {
  return status === "waiting" || status === "pending" || status === "running";
}

/** A list of your own to keep a picture in. */
function ListChooser({
  listId,
  onChange,
}: {
  listId: string | null;
  onChange: (listId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useBookmarkLists();
  const paths =
    data?.allPaths.filter((path) => {
      const list = path[path.length - 1];
      return list.type === "manual" && list.userRole !== "viewer";
    }) ?? [];
  const chosen = paths.find((path) => path[path.length - 1].id === listId);
  const list = chosen?.[chosen.length - 1];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/60"
          title={chosen ? listNameFromPath(chosen) : "Keep without a list"}
        >
          <span className="truncate">
            {list ? `${list.icon} ${list.name}` : "No list"}
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search lists..." />
          <CommandList>
            <CommandEmpty>No lists found.</CommandEmpty>
            <CommandGroup className="max-h-64 overflow-y-auto">
              <CommandItem
                value="__none__"
                keywords={["no list"]}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 size-4",
                    listId === null ? "opacity-100" : "opacity-0",
                  )}
                />
                No list
              </CommandItem>
              {paths.map((path) => {
                const option = path[path.length - 1];
                return (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    keywords={[option.name, option.icon]}
                    onSelect={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        option.id === listId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {listNameFromPath(path)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DiscoverTile({
  item,
  onKeep,
  onSkip,
}: {
  item: ZDiscoverItem;
  onKeep: (listId: string | null) => void;
  onSkip: () => void;
}) {
  const [listId, setListId] = useState(item.suggestedList?.id ?? null);
  return (
    <div className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl bg-muted">
      <a
        href={item.pinUrl}
        target="_blank"
        rel="noreferrer"
        title={item.title ?? undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbUrl}
          alt={item.title ?? ""}
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          className="w-full"
          style={
            item.width && item.height
              ? { aspectRatio: `${item.width} / ${item.height}` }
              : undefined
          }
        />
      </a>
      {item.error && (
        <p className="absolute inset-x-2 top-2 rounded-md bg-destructive/90 px-2 py-1 text-xs text-destructive-foreground">
          Couldn&apos;t save it — try again
        </p>
      )}
      {/* Always there by touch; on hover with a mouse. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
        <ListChooser listId={listId} onChange={setListId} />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onSkip}
            title="Skip — fewer like this"
            aria-label="Skip"
            className="flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
          >
            <X className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onKeep(listId)}
            title="Keep"
            aria-label="Keep"
            className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-transform hover:scale-105"
          >
            <Check className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const itemsQuery = api.discover.items.queryOptions();
  const { data } = useQuery(itemsQuery);
  const { data: settings } = useQuery(api.pictures.settings.queryOptions());
  const { data: status } = useQuery(
    api.pictures.status.queryOptions(undefined, {
      refetchInterval: (query) => {
        const job = query.state.data?.discover;
        return job && busy(job.status) ? 3000 : false;
      },
    }),
  );
  const job = status?.discover;
  const running = !!job && busy(job.status);

  // A run that finishes: what it found.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
    }
    wasRunning.current = running;
  }, [running, queryClient, itemsQuery.queryKey]);

  const refreshStatus = () =>
    queryClient.invalidateQueries(api.pictures.status.pathFilter());
  const refreshItems = () =>
    queryClient.invalidateQueries({ queryKey: itemsQuery.queryKey });
  /** Takes one off the page at once. */
  const drop = (id: string) =>
    queryClient.setQueryData(itemsQuery.queryKey, (old) =>
      old ? { items: old.items.filter((item) => item.id !== id) } : old,
    );
  const onError = (e: { message: string }) => {
    toast({ variant: "destructive", description: e.message });
    void refreshItems();
  };

  const { mutate: lookForMore, isPending: asking } = useMutation(
    api.discover.refresh.mutationOptions({
      onSuccess: () => void refreshStatus(),
      onError,
    }),
  );
  // The sidebar's count goes by the status.
  const { mutate: keep } = useMutation(
    api.discover.keep.mutationOptions({
      onMutate: ({ itemId }) => drop(itemId),
      onSuccess: () => void refreshStatus(),
      onError,
    }),
  );
  const { mutate: restore } = useMutation(
    api.discover.restore.mutationOptions({
      onSuccess: () => {
        void refreshItems();
        void refreshStatus();
      },
      onError,
    }),
  );
  const { mutate: skip } = useMutation(
    api.discover.skip.mutationOptions({
      onMutate: ({ itemId }) => drop(itemId),
      onSuccess: ({ alongWith }, { itemId }) => {
        void refreshStatus();
        if (alongWith > 0) {
          void refreshItems();
        }
        sonner(
          alongWith > 0 ? `Skipped, and ${alongWith} like it` : "Skipped",
          {
            action: { label: "Undo", onClick: () => restore({ itemId }) },
          },
        );
      },
      onError,
    }),
  );

  const items = data?.items ?? [];
  const off = settings && !settings.discoverEnabled;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">Discover</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {running
              ? "Looking for new pictures…"
              : `${items.length.toLocaleString()} new from Pinterest, like your pins`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          disabled={!!off || running || asking}
          onClick={() => lookForMore()}
        >
          {running ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Look for more
        </Button>
      </div>

      {off ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Discover is turned off in{" "}
          <Link
            href="/settings/pictures"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Settings → Pictures
          </Link>
          .
        </p>
      ) : !data ? null : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {running
            ? "Pinterest is being asked what's like your pins…"
            : job?.status === "failed"
              ? `The last look failed: ${job.error ?? "no reason given"}`
              : (job?.detail ?? "Nothing waiting — look for more.")}
        </p>
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 2xl:columns-5">
          {items.map((item) => (
            <DiscoverTile
              key={item.id}
              item={item}
              onKeep={(listId) => keep({ itemId: item.id, listId })}
              onSkip={() => skip({ itemId: item.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
