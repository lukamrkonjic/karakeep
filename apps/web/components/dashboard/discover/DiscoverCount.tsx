"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

/** Fork: how many pictures wait on the Discover page, beside its name. */
export function DiscoverCount() {
  const api = useTRPC();
  const { data } = useQuery(api.pictures.status.queryOptions());
  const fresh = data?.discover.fresh ?? 0;
  if (fresh === 0) {
    return null;
  }
  return (
    <span className="px-2.5 text-xs font-light text-muted-foreground">
      {fresh.toLocaleString()}
    </span>
  );
}
