"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * Fork: a link that opens a bookmark's preview. Its route is dynamic, so
 * Next doesn't fetch it ahead as the link scrolls into view, and a click
 * waited for the server before anything showed. This fetches it in full as
 * the pointer comes onto the link (or a finger touches it): by the click it's
 * there, and the preview opens at once. (Prefetching only runs in
 * production; `router.prefetch` is Next's own, with its full kind — what
 * `<Link prefetch>` does, for one link at a time.)
 */
export const PreviewLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<typeof Link> & { href: string }
>(function PreviewLink({ onPointerEnter, onTouchStart, ...props }, ref) {
  const router = useRouter();
  const prefetch = () =>
    router.prefetch(props.href, { kind: PrefetchKind.FULL });
  return (
    <Link
      ref={ref}
      {...props}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType === "mouse") {
          prefetch();
        }
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        prefetch();
      }}
    />
  );
});
