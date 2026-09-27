"use client";

import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shuffle } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: Discover — your own pictures you haven't seen in a while, picked by
 * what you've saved, liked and opened lately (routers/discover.ts). A new set
 * each day; Shuffle for another now.
 */
export default function DiscoverPage() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { data, error } = useQuery(api.discover.items.queryOptions());
  const { mutate: shuffle, isPending } = useMutation(
    api.discover.shuffle.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries(api.discover.items.pathFilter()),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  if (error) {
    throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">Discover</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Yours, not seen in a while — like what you&apos;ve saved lately
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          disabled={isPending}
          onClick={() => shuffle()}
        >
          <Shuffle className="size-4" />
          Shuffle
        </Button>
      </div>
      {!data ? (
        <BookmarksGridSkeleton />
      ) : data.bookmarks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing to rediscover yet — pictures turn up here once they&apos;re
          indexed and a few weeks old.
        </p>
      ) : (
        <BookmarksGrid bookmarks={data.bookmarks} />
      )}
    </div>
  );
}
