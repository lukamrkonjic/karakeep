"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Fork: a guest's own view of a guest link — columns and order — kept in
 * this browser only (a guest has no account to keep them in). Never the
 * owner's preferences: someone signed in opening the link mustn't change
 * their own grid from here.
 */
export interface GuestViewPrefs {
  columns: number;
  phoneColumns: number;
  sortOrder: "desc" | "asc";
}

const KEY = "guestShare.view";
const DEFAULTS: GuestViewPrefs = {
  columns: 4,
  phoneColumns: 2,
  sortOrder: "desc",
};

function read(): GuestViewPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useGuestViewPrefs() {
  const [prefs, setPrefs] = useState<GuestViewPrefs>(DEFAULTS);
  // After the first render: the server rendered the defaults.
  useEffect(() => setPrefs(read()), []);
  const update = useCallback((patch: Partial<GuestViewPrefs>) => {
    setPrefs((old) => {
      const next = { ...old, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private browsing: kept for this visit only.
      }
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
