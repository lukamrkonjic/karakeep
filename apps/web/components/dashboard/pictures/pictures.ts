"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

/**
 * Fork: what the picture features' components share (similar pictures,
 * search by description, list suggestions — routers/pictures.ts).
 */

/** The picture to show for a bookmark: its own, or a video's first frame. */
export function pictureAssetOf(bookmark: ZBookmark): string | null {
  if (bookmark.content.type !== BookmarkTypes.ASSET) {
    return null;
  }
  if (bookmark.content.assetType === "image") {
    return bookmark.content.assetId;
  }
  if (bookmark.content.assetType === "video") {
    return (
      bookmark.assets.find((a) => a.assetType === "videoThumbnail")?.id ?? null
    );
  }
  return null;
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
