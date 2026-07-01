"use client";

import { useEffect } from "react";
import Image from "next/image";
import { imageLoadGate } from "@/lib/assetLoadGate";
import { useNearViewportLoadSlot } from "@/lib/hooks/useNearViewportLoadSlot";
import { cn } from "@/lib/utils";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

/**
 * Renders the actual <Image> only once granted a load slot (see
 * assetLoadGate.ts) — karakeep doesn't store image dimensions, so every tile
 * starts at width=0/height=0 and only gets its real size once bytes start
 * arriving; letting dozens of tiles all request at once on mount/fast-scroll
 * can overwhelm a modest self-hosted server's connection pool and leave some
 * stuck indefinitely. A placeholder box holds the tile's place in the
 * masonry column until its turn comes.
 *
 * Shared by MasonryMediaCard (image tiles) and BookmarkVideo (video poster
 * thumbnails, which naturally render at the video's own aspect ratio once
 * loaded, same as any other image).
 */
export function GatedImage({
  assetId,
  alt,
  className,
}: {
  assetId: string;
  alt: string;
  className?: string;
}) {
  const { containerRef, granted, release } = useNearViewportLoadSlot(
    imageLoadGate,
    { rootMargin: "600px" },
  );

  // Safety net: don't hold the slot forever if load/error never fires.
  useEffect(() => {
    if (!granted) return;
    const timer = window.setTimeout(release, 15000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted]);

  if (!granted) {
    return (
      <div
        ref={containerRef}
        className={cn("aspect-[3/4] w-full animate-pulse bg-muted", className)}
      />
    );
  }

  return (
    <Image
      alt={alt}
      src={getAssetUrl(assetId)}
      width={0}
      height={0}
      sizes="100vw"
      unoptimized
      draggable={false}
      className={cn("block h-auto w-full", className)}
      onLoad={release}
      onError={release}
    />
  );
}
