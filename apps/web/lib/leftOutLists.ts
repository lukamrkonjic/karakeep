"use client";

import { useCallback } from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { useQueryClient } from "@tanstack/react-query";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";

const NONE: string[] = [];

/**
 * Fork: the lists left out of colours (List settings → Colours), kept in
 * the account (lib/uiPreferences.tsx): the server leaves their pictures out
 * of every colour page and every smart list that asks for a colour
 * (packages/shared/colourLeftOut.ts). Each takes everything under it with
 * it, as a smart list's "Lists doesn't contain" does.
 */
export function useColourLeftOut(): string[] {
  return usePreference("colourLeftOutLists") ?? NONE;
}

/** Changes them; once the server has them, what they leave out reloads. */
export function useSetColourLeftOut() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const updatePreferences = useUpdatePreferences();
  return useCallback(
    async (listIds: string[]) => {
      await updatePreferences({ colourLeftOutLists: listIds });
      void queryClient.invalidateQueries(api.pictures.byColour.pathFilter());
      void queryClient.invalidateQueries(api.lists.stats.pathFilter());
      void queryClient.invalidateQueries(
        api.bookmarks.getBookmarks.pathFilter(),
      );
    },
    [api, queryClient, updatePreferences],
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
