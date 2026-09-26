"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { isEmojiIcon } from "@/lib/emoji";
import { useQuery } from "@tanstack/react-query";
import { Check, Folder, Play, X } from "lucide-react";

import type { ZSuggestionGroup } from "@karakeep/shared/types/pictures";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import {
  useAcceptSuggestions,
  useDismissSuggestions,
} from "../pictures/pictures";

/**
 * Fork: Cleanups → List suggestions ("Belongs in…"). New pictures, by the
 * list their closest matches are in (the suggestions job, Settings →
 * Pictures): add them there a list at a time, or one by one.
 */

function Group({
  group,
  accept,
  dismiss,
}: {
  group: ZSuggestionGroup;
  accept: (ids: string[]) => void;
  dismiss: (ids: string[]) => void;
}) {
  const ids = group.pictures.map((p) => p.suggestionId);
  const { list, pictures } = group;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={`/dashboard/lists/${list.id}`}
          className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
        >
          {isEmojiIcon(list.icon) ? (
            <span>{list.icon}</span>
          ) : (
            <Folder className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{list.name}</span>
        </Link>
        <span className="text-sm text-muted-foreground">
          {pictures.length.toLocaleString()}{" "}
          {pictures.length === 1 ? "picture" : "pictures"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => accept(ids)}>
            Add {pictures.length === 1 ? "it" : `all ${pictures.length}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismiss(ids)}>
            Not this list
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {pictures.map((picture) => (
          <div
            key={picture.suggestionId}
            className="relative size-24 overflow-hidden rounded-md bg-muted"
          >
            <Link
              href={`/dashboard/preview/${picture.bookmarkId}`}
              title={picture.title ?? undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getAssetUrl(picture.imageAssetId)}
                alt={picture.title ?? ""}
                loading="lazy"
                draggable={false}
                className="size-full object-cover"
              />
            </Link>
            {picture.kind === "video" && (
              <Play className="pointer-events-none absolute bottom-1 left-1 size-3.5 fill-white text-white drop-shadow" />
            )}
            <div className="absolute right-1 top-1 flex gap-1">
              <button
                type="button"
                onClick={() => accept([picture.suggestionId])}
                title={`Add to ${list.name}`}
                aria-label={`Add to ${list.name}`}
                className="flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-primary"
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => dismiss([picture.suggestionId])}
                title="Not this list"
                aria-label="Not this list"
                className="flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/80"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSuggestions() {
  const api = useTRPC();
  const { data: settings } = useQuery(api.pictures.settings.queryOptions());
  const { data } = useQuery(api.pictures.suggestionGroups.queryOptions());
  const onError = (message: string) =>
    toast({ variant: "destructive", description: message });
  const { mutate: accept } = useAcceptSuggestions(onError);
  const { mutate: dismiss } = useDismissSuggestions(onError);

  if (!settings || !data) {
    return null;
  }
  if (!settings.suggestionsEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        List suggestions are turned off in{" "}
        <Link
          href="/settings/pictures"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Settings → Pictures
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        New pictures, by the list their closest matches are in. Adding one keeps
        it where it is too; &ldquo;Not this list&rdquo; won&apos;t suggest it
        there again.
      </p>
      {data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to sort right now.
        </p>
      ) : (
        data.groups.map((group) => (
          <Group
            key={group.list.id}
            group={group}
            accept={(ids) => accept({ ids })}
            dismiss={(ids) => dismiss({ ids })}
          />
        ))
      )}
    </div>
  );
}
