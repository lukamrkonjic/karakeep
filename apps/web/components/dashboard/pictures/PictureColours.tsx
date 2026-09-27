"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: a picture's main colours in its details, the biggest first (the
 * workers read them: Settings → Pictures → Colours). A swatch opens
 * everything in that colour.
 */
export function PictureColours({ bookmarkId }: { bookmarkId: string }) {
  const api = useTRPC();
  const { data } = useQuery(api.pictures.colours.queryOptions({ bookmarkId }));
  if (!data || data.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-1.5">
      {data.map((colour) => (
        <Link
          key={colour.hex}
          href={`/dashboard/colour/${colour.hex.slice(1)}`}
          title={`${colour.hex} · ${Math.round(colour.share * 100)}%`}
          aria-label={`Pictures in ${colour.hex}`}
          className="size-6 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 dark:ring-white/15"
          style={{ backgroundColor: colour.hex }}
        />
      ))}
    </div>
  );
}
