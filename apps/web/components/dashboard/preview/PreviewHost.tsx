"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  isPreviewInPlace,
  previewIdOf,
  registerPreviewHost,
} from "@/lib/previewNavigation";

import { PreviewDialog } from "./PreviewDialog";

/**
 * Fork: shows a preview opened in place (lib/previewNavigation.ts) over
 * whatever page is open. Back, or closing it, goes back to that page as it
 * was left.
 */
export function PreviewHost() {
  const pathname = usePathname();
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);

  useEffect(() => registerPreviewHost(), []);
  // Read after the address changed: the history entry says whether this
  // preview was opened in place.
  useEffect(() => {
    setBookmarkId(isPreviewInPlace() ? previewIdOf(pathname) : null);
  }, [pathname]);

  if (!bookmarkId) {
    return null;
  }
  return (
    <PreviewDialog
      // A new dialog for the next picture (Similar pictures, phone swipes).
      key={bookmarkId}
      bookmarkId={bookmarkId}
      onClose={() => window.history.back()}
    />
  );
}
