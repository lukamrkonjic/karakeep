"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePreferences, useUpdatePreferences } from "@/lib/uiPreferences";
import {
  defaultUserLocalSettings,
  parseUserLocalSettings,
  USER_LOCAL_SETTINGS_COOKIE_NAME,
} from "@/lib/userLocalSettings/types";
import { useQueryClient } from "@tanstack/react-query";

import type { ZUiPreferences } from "@karakeep/shared/types/uiPreferences";
import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: preferences used to live in each browser — the fork's in
 * localStorage and cookies, upstream's view options in a cookie, the theme in
 * localStorage. The first time a browser opens the app signed in, whatever
 * it had customised moves to the account wherever the account has nothing
 * yet (so the first device to arrive can't wipe the others' choices with its
 * defaults), and the fork's copies are cleared. Upstream's cookie and the
 * theme's key stay: the signed-out pages still read them.
 */

const FORK_STORAGE = [
  "karakeep-tailored-feed",
  "karakeep-preview-details-hidden",
  "karakeep-sidebar-collapsed",
];
const FORK_COOKIES = ["karakeep-sort", "karakeep-sublists"];

function readCookie(name: string): string | undefined {
  const entry = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`));
  if (entry === undefined) {
    return undefined;
  }
  const value = entry.slice(name.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A field of a zustand-persist entry ({"state": {…}, "version": 0}). */
function readPersisted(name: string, field: string): unknown {
  try {
    const raw = localStorage.getItem(name);
    return raw
      ? (JSON.parse(raw) as { state?: Record<string, unknown> }).state?.[field]
      : undefined;
  } catch {
    return undefined;
  }
}

/** What this browser customised that the account hasn't got. */
function legacyPatch(prefs: ZUiPreferences): Partial<ZUiPreferences> {
  const patch: Partial<ZUiPreferences> = {};

  const excluded = readPersisted("karakeep-tailored-feed", "excluded");
  if (
    prefs.tailoredFeedExcluded === undefined &&
    Array.isArray(excluded) &&
    excluded.length > 0
  ) {
    patch.tailoredFeedExcluded = excluded.filter(
      (id): id is string => typeof id === "string",
    );
  }
  if (
    prefs.previewDetailsHidden === undefined &&
    readPersisted("karakeep-preview-details-hidden", "hidden") === true
  ) {
    patch.previewDetailsHidden = true;
  }
  if (
    prefs.sidebarCollapsed === undefined &&
    readPersisted("karakeep-sidebar-collapsed", "collapsed") === true
  ) {
    patch.sidebarCollapsed = true;
  }

  // "list:abc=random|feed=oldest". "lists" was the All Lists page, now gone.
  const sorts = (readCookie("karakeep-sort") ?? "")
    .split("|")
    .map((entry) => {
      const at = entry.lastIndexOf("=");
      return [entry.slice(0, Math.max(at, 0)), entry.slice(at + 1)] as const;
    })
    .filter(
      ([key, sort]) =>
        key &&
        sort &&
        key !== "lists" &&
        key.length <= 100 &&
        sort.length <= 20,
    );
  if (prefs.pageSorts === undefined && sorts.length > 0) {
    patch.pageSorts = Object.fromEntries(sorts);
  }
  const sublists = (readCookie("karakeep-sublists") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (prefs.sublists === undefined && sublists.length > 0) {
    patch.sublists = sublists;
  }

  let theme: string | null = null;
  try {
    theme = localStorage.getItem("theme");
  } catch {
    // Storage blocked: nothing to bring over.
  }
  if (prefs.theme === undefined && (theme === "light" || theme === "dark")) {
    patch.theme = theme;
  }

  // Upstream's view options: only what differs from the defaults.
  const cookie = readCookie(USER_LOCAL_SETTINGS_COOKIE_NAME);
  const local = cookie ? parseUserLocalSettings(cookie) : undefined;
  if (local) {
    const defaults = defaultUserLocalSettings();
    for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      if (prefs[key] === undefined && local[key] !== defaults[key]) {
        Object.assign(patch, {
          [key]: key === "gridColumns" ? Math.round(local[key]) : local[key],
        });
      }
    }
  }
  return patch;
}

function clearForkCopies() {
  try {
    FORK_STORAGE.forEach((name) => localStorage.removeItem(name));
  } catch {
    // Storage blocked: nothing was kept there either.
  }
  for (const name of FORK_COOKIES) {
    if (readCookie(name) !== undefined) {
      document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
    }
  }
}

/** Mounted once, signed in. Renders nothing. */
export function LegacyPreferencesImport() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) {
      return;
    }
    ran.current = true;
    if (Object.keys(legacyPatch(prefs)).length === 0) {
      clearForkCopies();
      return;
    }
    void (async () => {
      // The page's copy falls back to none when the server couldn't read it:
      // check the account's own before filling its gaps.
      let current: ZUiPreferences;
      try {
        current = await queryClient.fetchQuery(
          api.uiPreferences.get.queryOptions(),
        );
      } catch {
        return;
      }
      const patch = legacyPatch(current);
      if (
        Object.keys(patch).length > 0 &&
        !(await update(patch, { immediate: true }))
      ) {
        return;
      }
      clearForkCopies();
      // Server-rendered pages order and fill themselves from these.
      if (patch.pageSorts || patch.sublists) {
        router.refresh();
      }
    })();
  }, [prefs, update, api, queryClient, router]);

  return null;
}
