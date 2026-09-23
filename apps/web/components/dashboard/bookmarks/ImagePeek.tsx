"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

const PEEK_DELAY_MS = 120;

/**
 * Fork: a magnifier in an image tile's bottom-right corner (on the tile's
 * hover, like its other buttons). Pointing at it shows the picture large over
 * the dimmed page until the pointer moves off — a sneak peek without opening
 * it; a click opens it. A moment's delay keeps a pointer passing over it on
 * its way elsewhere from flashing pictures. Devices without hover don't get
 * one.
 */
export function ImagePeek({
  assetId,
  bookmarkId,
  alt,
}: {
  assetId: string;
  bookmarkId: string;
  alt: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), PEEK_DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <Link
        href={`/dashboard/preview/${bookmarkId}`}
        aria-label="Peek at the image"
        draggable={false}
        onPointerEnter={show}
        onPointerLeave={hide}
        onClick={hide}
        // A bare white icon on the dimmed tile, like the "…" above it.
        className="absolute bottom-2 right-2 z-20 hidden p-1.5 text-white opacity-0 drop-shadow transition-opacity duration-200 hover:text-white/80 group-hover:opacity-100 [@media(hover:hover)]:flex"
      >
        <Search className="size-5" />
      </Link>
      {open &&
        createPortal(
          // Never in the way: the pointer stays on the magnifier underneath.
          // As dark as the preview's backdrop, with the picture at its own
          // size (capped like the preview's), never blown up to the window.
          <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/95 duration-150 animate-in fade-in-0">
            <Image
              src={getAssetUrl(assetId)}
              alt={alt}
              width={0}
              height={0}
              sizes="100vw"
              unoptimized
              className="h-auto max-h-[92vh] w-auto max-w-[95vw] duration-150 animate-in zoom-in-95"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
