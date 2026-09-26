"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

/**
 * Fork: what the picture features' components share (similar pictures,
 * search by description, list suggestions — routers/pictures.ts).
 */

/**
 * The picture to show for a bookmark: a picture bookmark's own file, or a
 * video's first frame — a video bookmark's, or a note's or link's with one
 * (the same pictures as the fingerprints: shared-server pictureSources.ts).
 */
export function pictureOf(
  bookmark: ZBookmark,
): { assetId: string; video: boolean } | null {
  if (
    bookmark.content.type === BookmarkTypes.ASSET &&
    bookmark.content.assetType === "image"
  ) {
    return { assetId: bookmark.content.assetId, video: false };
  }
  const frame = bookmark.assets.find((a) => a.assetType === "videoThumbnail");
  return frame ? { assetId: frame.id, video: true } : null;
}

/** Refreshes what adding to a list, or a suggestion going away, changes. */
function useRefreshSuggestions() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(api.pictures.suggestionsFor.pathFilter()),
      queryClient.invalidateQueries(api.pictures.suggestionGroups.pathFilter()),
      queryClient.invalidateQueries(api.pictures.status.pathFilter()),
      queryClient.invalidateQueries(api.lists.getListsOfBookmark.pathFilter()),
      queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter()),
      queryClient.invalidateQueries(api.lists.stats.pathFilter()),
    ]);
}

export function useAcceptSuggestions(onError: (message: string) => void) {
  const api = useTRPC();
  const refresh = useRefreshSuggestions();
  return useMutation(
    api.pictures.acceptSuggestions.mutationOptions({
      onSuccess: () => void refresh(),
      onError: (e) => onError(e.message),
    }),
  );
}

export function useDismissSuggestions(onError: (message: string) => void) {
  const api = useTRPC();
  const refresh = useRefreshSuggestions();
  return useMutation(
    api.pictures.dismissSuggestions.mutationOptions({
      onSuccess: () => void refresh(),
      onError: (e) => onError(e.message),
    }),
  );
}
