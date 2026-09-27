"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: a picture's main colours on top of its details, as one strip the way
 * Eagle shows them, the biggest first (the workers read them: Settings →
 * Pictures → Colours). A colour opens every picture with it.
 */
export function PictureColours({ bookmarkId }: { bookmarkId: string }) {
  const api = useTRPC();
  const { data } = useQuery(api.pictures.colours.queryOptions({ bookmarkId }));
  if (!data || data.length === 0) {
    return null;
  }
  return (
    <div className="flex h-7 w-full overflow-hidden rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10">
      {data.map((colour) => (
        <Link
          key={colour.hex}
          href={`/dashboard/colour/${colour.hex.slice(1)}`}
          title={`${colour.hex} · ${Math.round(colour.share * 100)}%`}
          aria-label={`Pictures in ${colour.hex}`}
          className="h-full flex-1 transition-[flex-grow] duration-150 hover:grow-[1.6]"
          style={{ backgroundColor: colour.hex }}
        />
      ))}
    </div>
  );
}
