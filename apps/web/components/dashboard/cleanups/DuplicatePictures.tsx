"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { Button } from "@/components/ui/button";
import FormattedDate from "@/components/ui/formatted-date";
import { toast } from "@/components/ui/sonner";
import LoadingSpinner from "@/components/ui/spinner";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { cn, formatBytes } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  DuplicateMatchLevel,
  ZDuplicateGroup,
  ZDuplicatePicture,
} from "@karakeep/shared/types/duplicatePictures";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  bestDuplicate,
  DEFAULT_DUPLICATE_MATCH_LEVEL,
} from "@karakeep/shared/types/duplicatePictures";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

/**
 * Fork: Cleanups → Duplicate pictures. The workers compare the pictures'
 * fingerprints — Immich's picture model's — every night, or when asked
 * (apps/workers/workers/duplicatesWorker.ts; Settings → Pictures); here the
 * alike ones are, group by group, to keep one or all.
 */

const LEVELS: { level: DuplicateMatchLevel; label: string; hint: string }[] = [
  {
    level: "identical",
    label: "Identical",
    hint: "The same picture at another size, re-saved, or mirrored.",
  },
  {
    level: "near",
    label: "Near-identical",
    hint: "Also recompressed, recropped or lightly edited copies.",
  },
  {
    level: "similar",
    label: "Similar",
    hint: "Also heavier crops and edits — and now and then two shots of the same scene.",
  },
];

function useInvalidateDuplicates() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(api.duplicatePictures.list.pathFilter()),
      queryClient.invalidateQueries(api.duplicatePictures.status.pathFilter()),
    ]);
}

function CheckStatus() {
  const api = useTRPC();
  const invalidate = useInvalidateDuplicates();
  const { data: status } = useQuery(
    api.duplicatePictures.status.queryOptions(undefined, {
      refetchInterval: (query) =>
        query.state.data?.status === "waiting" ||
        query.state.data?.status === "pending" ||
        query.state.data?.status === "running"
          ? 4000
          : false,
    }),
  );
  const { mutate: check, isPending } = useMutation(
    api.duplicatePictures.check.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );

  // A check that just finished may have found new ones.
  const previous = useRef(status?.status);
  useEffect(() => {
    if (
      (previous.current === "running" ||
        previous.current === "pending" ||
        previous.current === "waiting") &&
      status?.status === "done"
    ) {
      void invalidate();
    }
    previous.current = status?.status;
  }, [status?.status]);

  if (!status) {
    return null;
  }
  const busy =
    status.status === "waiting" ||
    status.status === "pending" ||
    status.status === "running";
  const counted = `${status.checked.toLocaleString()} of ${status.total.toLocaleString()} pictures looked at`;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Every night at 3:00 — or when you ask:{" "}
        <Link
          href="/settings/pictures"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Settings → Pictures
        </Link>{" "}
        — the pictures you saved since are compared with all of yours, and the
        ones that show the same picture are listed here. Keeping one gives it
        the others&apos; lists, tags and favourite, and deletes the others.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          variant="outline"
          size="sm"
          loading={isPending}
          disabled={busy}
          onClick={() => check()}
        >
          {busy ? "Checking…" : "Check now"}
        </ActionButton>
        <span>
          {status.status === "waiting" &&
            "Waiting for new pictures to be indexed… "}
          {status.status === "pending" && "Waiting for the workers… "}
          {status.status === "running" && `Checking: ${counted}.`}
          {status.status === "never" && "Not checked yet."}
          {(status.status === "done" || status.status === "failed") &&
            status.checkedAt && (
              <>
                Last checked <FormattedDate date={status.checkedAt} />:{" "}
                {counted}.
              </>
            )}
        </span>
      </div>
      {status.status === "failed" && status.error && (
        <p className="text-destructive">
          The last check failed: {status.error}
        </p>
      )}
      {status.status === "never" && status.total > 0 && (
        <p className="text-muted-foreground">
          The first check downloads the model (350 MB) and looks at all{" "}
          {status.total.toLocaleString()} pictures, which takes a while on a
          NAS.
        </p>
      )}
    </div>
  );
}

function sourceHost(url: string | null) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function Picture({
  picture,
  largest,
  onKeep,
  keeping,
  busy,
}: {
  picture: ZDuplicatePicture;
  /** The one "Keep the largest of each" would keep. */
  largest: boolean;
  onKeep: () => void;
  keeping: boolean;
  busy: boolean;
}) {
  const host = sourceHost(picture.sourceUrl);
  return (
    <div className="flex w-56 flex-col gap-2 text-xs">
      <Link
        href={`/dashboard/preview/${picture.bookmarkId}`}
        className="relative flex h-56 items-center justify-center overflow-hidden rounded-md bg-muted"
      >
        {/* oxlint-disable-next-line nextjs/no-img-element */}
        <img
          src={getAssetUrl(picture.imageAssetId)}
          alt={picture.title ?? ""}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain"
        />
        {picture.kind === "video" && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-white">
            Video
          </span>
        )}
      </Link>
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        <span className="truncate text-sm text-foreground">
          {picture.title || "Untitled"}
        </span>
        <span>
          {picture.width && picture.height
            ? `${picture.width} × ${picture.height} · `
            : ""}
          {formatBytes(picture.size, 1)}
          {largest && <span className="text-foreground"> · Largest</span>}
        </span>
        <span className="truncate">
          Saved <FormattedDate date={picture.createdAt} formatStr="PP" />
          {host ? ` · ${host}` : ""}
        </span>
        <span className="truncate">
          {picture.lists.length > 0
            ? `In ${picture.lists.map((l) => l.name).join(", ")}`
            : "In no list"}
          {picture.favourited ? " · ★ Favourite" : ""}
        </span>
      </div>
      <ActionButton
        variant="outline"
        size="sm"
        className="self-start"
        loading={keeping}
        disabled={busy}
        onClick={onKeep}
      >
        Keep this one
      </ActionButton>
    </div>
  );
}

function Group({ group }: { group: ZDuplicateGroup }) {
  const api = useTRPC();
  const invalidate = useInvalidateDuplicates();
  const ids = group.pictures.map((p) => p.bookmarkId);
  const keep = useMutation(
    api.duplicatePictures.keep.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const keepAll = useMutation(
    api.duplicatePictures.keepAll.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const busy = keep.isPending || keepAll.isPending;
  const largest = bestDuplicate(group.pictures).bookmarkId;
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap gap-6">
        {group.pictures.map((picture) => (
          <Picture
            key={picture.bookmarkId}
            picture={picture}
            largest={picture.bookmarkId === largest}
            busy={busy}
            keeping={
              keep.isPending &&
              keep.variables?.keepBookmarkId === picture.bookmarkId
            }
            onKeep={() =>
              keep.mutate({
                keepBookmarkId: picture.bookmarkId,
                bookmarkIds: ids,
              })
            }
          />
        ))}
      </div>
      <div>
        <ActionButton
          variant="outline"
          size="sm"
          loading={keepAll.isPending}
          disabled={busy}
          onClick={() => keepAll.mutate({ bookmarkIds: ids })}
        >
          Not duplicates: keep all
        </ActionButton>
      </div>
    </div>
  );
}

function KeepLargestButton({
  level,
  groups,
}: {
  level: DuplicateMatchLevel;
  groups: number;
}) {
  const api = useTRPC();
  const invalidate = useInvalidateDuplicates();
  const { mutate, isPending } = useMutation(
    api.duplicatePictures.keepBest.mutationOptions({
      onSuccess: (result) => {
        void invalidate();
        toast({
          description: `Kept the largest picture of ${result.groups} groups and deleted ${result.deleted} copies.`,
        });
      },
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  return (
    <ActionConfirmingDialog
      title="Keep the largest of every group?"
      description={`In each of the ${groups} groups, the picture with the most pixels is kept and takes the others' lists, tags and favourite. The others are deleted.`}
      actionButton={(setDialogOpen) => (
        <ActionButton
          variant="destructive"
          loading={isPending}
          onClick={() =>
            mutate({ level }, { onSettled: () => setDialogOpen(false) })
          }
        >
          Keep the largest, delete the rest
        </ActionButton>
      )}
    >
      <Button variant="outline" size="sm">
        Keep the largest of each
      </Button>
    </ActionConfirmingDialog>
  );
}

export function DuplicatePictures() {
  const api = useTRPC();
  const level =
    usePreference("duplicatePicturesMatch") ?? DEFAULT_DUPLICATE_MATCH_LEVEL;
  const updatePreferences = useUpdatePreferences();
  const { data, isPending } = useQuery(
    api.duplicatePictures.list.queryOptions({ level }),
  );

  return (
    <div className="flex flex-col gap-4">
      <CheckStatus />
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-2 basis-full sm:basis-auto">How alike:</span>
          {LEVELS.map((l) => (
            <Button
              key={l.level}
              size="sm"
              variant={l.level === level ? "secondary" : "ghost"}
              className={cn(l.level === level && "font-semibold")}
              onClick={() =>
                void updatePreferences({ duplicatePicturesMatch: l.level })
              }
            >
              {l.label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground">
          {LEVELS.find((l) => l.level === level)?.hint}
        </p>
      </div>
      {isPending ? (
        <LoadingSpinner />
      ) : !data || data.total === 0 ? (
        <p className="text-sm text-muted-foreground">No duplicates found.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              {data.total === 1
                ? "1 group"
                : `${data.total.toLocaleString()} groups`}
              {data.total > data.groups.length &&
                ` (showing ${data.groups.length})`}
            </span>
            <KeepLargestButton level={level} groups={data.total} />
          </div>
          {data.groups.map((group) => (
            <Group
              key={group.pictures.map((p) => p.bookmarkId).join()}
              group={group}
            />
          ))}
        </>
      )}
    </div>
  );
}
