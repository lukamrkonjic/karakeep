"use client";

import { useCallback } from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";

const NONE: string[] = [];

/**
 * Fork: the lists every colour page leaves out (its "…" → Leave lists out…),
 * kept in the account (lib/uiPreferences.tsx). Each takes everything under
 * it with it, as a smart list's "Lists doesn't contain" does — which is
 * what they become when the page is saved as a smart list.
 */
export function useColourLeftOut(): string[] {
  return usePreference("colourLeftOutLists") ?? NONE;
}

export function useSetColourLeftOut() {
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    (listIds: string[]) =>
      void updatePreferences({ colourLeftOutLists: listIds }),
    [updatePreferences],
  );
}

/**
 * Left-out lists as the picker shows them and as they're kept. Kept, a list
 * stands for itself and everything under it; shown, every list under a
 * left-out one is ticked off too (`expand`), and a folder with only some
 * of its sub-lists left out keeps those, not the folder (`compress`).
 */
export function leftOutTree(lists: ZBookmarkList[]) {
  const known = new Set(lists.map((l) => l.id));
  const parentOf = new Map(lists.map((l) => [l.id, l.parentId]));
  const children = new Map<string, string[]>();
  for (const l of lists) {
    if (l.parentId && known.has(l.parentId)) {
      children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
    }
  }
  const walk = (id: string): string[] => [
    id,
    ...(children.get(id) ?? []).flatMap(walk),
  ];
  return {
    /** A list and everything under it. */
    walk,
    /** Kept → shown: every list a left-out one takes with it. */
    expand: (leftOut: string[]) =>
      new Set(leftOut.filter((id) => known.has(id)).flatMap(walk)),
    /** Shown → kept: the fewest lists that leave out just these. */
    compress: (out: Set<string>) => {
      const whole = (id: string) => walk(id).every((x) => out.has(x));
      return lists
        .filter((l) => {
          const parent = parentOf.get(l.id);
          return whole(l.id) && !(parent && known.has(parent) && whole(parent));
        })
        .map((l) => l.id);
    },
    /** Left-out lists the picker doesn't show (gone, or not yours): kept. */
    unknown: (leftOut: string[]) => leftOut.filter((id) => !known.has(id)),
  };
}

/** The same lists, in any order. */
export const sameLists = (a: string[], b: string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;
