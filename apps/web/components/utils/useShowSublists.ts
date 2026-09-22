"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseSublists,
  serializeSublists,
  SUBLISTS_COOKIE,
} from "@/lib/sublists";

function readCookie(): string {
  if (typeof document === "undefined") {
    return "";
  }
  return (
    document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${SUBLISTS_COOKIE}=`))
      ?.slice(SUBLISTS_COOKIE.length + 1) ?? ""
  );
}

/**
 * Whether this list shows the items of everything nested under it, and a
 * toggle for it (see the list page, which reads the same cookie on the
 * server). Reads after mount so the server's markup is never contradicted.
 */
export function useShowSublists(listId: string) {
  const router = useRouter();
  const [showSublists, setShowSublists] = useState(false);
  useEffect(() => {
    setShowSublists(parseSublists(readCookie()).has(listId));
  }, [listId]);

  const onClickShowSublists = useCallback(() => {
    const ids = parseSublists(readCookie());
    if (ids.has(listId)) {
      ids.delete(listId);
    } else {
      ids.add(listId);
    }
    // A year, path-wide, so it holds for every list page in this browser.
    document.cookie = `${SUBLISTS_COOKIE}=${serializeSublists(ids)}; path=/; max-age=31536000; samesite=lax`;
    setShowSublists(ids.has(listId));
    router.refresh();
  }, [listId, router]);

  return { showSublists, onClickShowSublists };
}
