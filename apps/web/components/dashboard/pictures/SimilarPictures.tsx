"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { pictureOf } from "./pictures";

/** Shown in the details; the rest are a click away. */
const SHOWN = 9;

/**
 * Fork: "More like this" in a picture's details — the pictures most like it
 * from all the user's lists (Settings → Pictures says how alike), each opening
 * in its place, and a page with all of them. Nothing when there are none, or
 * the picture has no fingerprint yet.
 */
export function SimilarPictures({ bookmarkId }: { bookmarkId: string }) {
  const api = useTRPC();
  const { data } = useQuery(
    api.pictures.similar.queryOptions({ bookmarkId, limit: SHOWN }),
  );
  if (!data || data.total === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Similar</p>
        <Link
          href={`/dashboard/similar/${bookmarkId}`}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {data.total > SHOWN
            ? `See all ${data.total.toLocaleString()}`
            : "See all"}
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {data.bookmarks.map((bookmark) => {
          const picture = pictureOf(bookmark);
          if (!picture) {
            return null;
          }
          return (
            <Link
              key={bookmark.id}
              // Opens in the preview's place, not on top of it.
              replace
              href={`/dashboard/preview/${bookmark.id}`}
              title={bookmark.title ?? undefined}
              className="group relative block aspect-square overflow-hidden rounded-md bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getAssetUrl(picture.assetId)}
                alt={bookmark.title ?? ""}
                loading="lazy"
                draggable={false}
                className="size-full object-cover transition-opacity group-hover:opacity-80"
              />
              {picture.video && (
                <Play className="absolute bottom-1 right-1 size-3.5 fill-white text-white drop-shadow" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
