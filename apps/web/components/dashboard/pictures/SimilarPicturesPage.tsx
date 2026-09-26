"use client";

import Link from "next/link";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import { pictureOf } from "./pictures";

/**
 * Fork: "More like this", all of it — every picture like this one from all
 * the user's lists, the most alike first (Settings → Pictures says how
 * alike).
 */
export default function SimilarPicturesPage({
  bookmarkId,
}: {
  bookmarkId: string;
}) {
  const api = useTRPC();
  const { data: source } = useQuery(
    api.bookmarks.getBookmark.queryOptions({ bookmarkId }),
  );
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(
      api.pictures.similar.infiniteQueryOptions(
        { bookmarkId },
        {
          initialCursor: 0,
          getNextPageParam: (page) => page.nextCursor,
        },
      ),
    );
  if (error) {
    throw error;
  }
  const picture = source ? pictureOf(source) : null;
  const total = data?.pages[0]?.total;
  const name = source?.title?.trim();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {picture && (
          <Link
            href={`/dashboard/preview/${bookmarkId}`}
            className="shrink-0 overflow-hidden rounded-xl bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getAssetUrl(picture.assetId)}
              alt={name ?? ""}
              className="size-16 object-cover"
            />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold leading-tight">
            Similar pictures
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {total === undefined
              ? "Looking…"
              : `${total.toLocaleString()} like ${name ? `“${name}”` : "this one"}, from all your lists`}
          </p>
        </div>
      </div>
      {!data ? (
        <BookmarksGridSkeleton />
      ) : total === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing like it — or it isn&apos;t indexed yet (Settings → Pictures).
        </p>
      ) : (
        <BookmarksGrid
          bookmarks={data.pages.flatMap((page) => page.bookmarks)}
          hasNextPage={hasNextPage}
          fetchNextPage={() => void fetchNextPage()}
          isFetchingNextPage={isFetchingNextPage}
        />
      )}
    </div>
  );
}
