import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ZBookmarkList } from "@karakeep/shared/types/lists";
import {
  listsToTree,
  positionAmong,
  ZBookmarkListRoot,
} from "@karakeep/shared/utils/listUtils";

import { useTRPC } from "../trpc";
import { scheduleInvalidateQueries } from "./query-invalidation";

type TRPCApi = ReturnType<typeof useTRPC>;

export function useCreateBookmarkList(
  opts?: Parameters<TRPCApi["lists"]["create"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.create.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        queryClient.invalidateQueries(api.lists.list.pathFilter());
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

export function useEditBookmarkList(
  opts?: Parameters<TRPCApi["lists"]["edit"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.edit.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        queryClient.invalidateQueries(api.lists.list.pathFilter());
        queryClient.invalidateQueries(
          api.lists.get.queryFilter({ listId: req.listId }),
        );
        if (res.type === "smart") {
          queryClient.invalidateQueries(
            api.bookmarks.getBookmarks.queryFilter({ listId: req.listId }),
          );
          queryClient.invalidateQueries(
            api.bookmarks.getBookmarks.infiniteQueryFilter({
              listId: req.listId,
            }),
          );
        }
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

export function useReorderBookmarkList(
  opts?: Parameters<TRPCApi["lists"]["reorder"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.reorder.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        queryClient.invalidateQueries(api.lists.list.pathFilter());
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

/**
 * Fork: moves a list under another (or to the top level: null), to `index`
 * among its new siblings — shown at once (the lists as the server will
 * leave them), put back if the server says no.
 */
export function useMoveBookmarkList() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const lists = api.lists.list.pathFilter();
  return useMutation(
    api.lists.move.mutationOptions({
      onMutate: async (req) => {
        await queryClient.cancelQueries(lists);
        const before = queryClient.getQueriesData<{ lists: ZBookmarkList[] }>(
          lists,
        );
        queryClient.setQueriesData<{ lists: ZBookmarkList[] }>(lists, (old) =>
          old ? { ...old, lists: movedList(old.lists, req) } : old,
        );
        return { before };
      },
      onError: (_err, _req, saved) => {
        saved?.before.forEach(([key, data]) =>
          queryClient.setQueryData(key, data),
        );
      },
      // A list's count and what it shows take in its sub-lists' (so do
      // smart lists of "in this list"): fetched again once the last of a
      // run of moves is in.
      onSettled: () => {
        if (
          queryClient.isMutating({
            mutationKey: api.lists.move.mutationKey(),
          }) > 1
        ) {
          return;
        }
        queryClient.invalidateQueries(lists);
        queryClient.invalidateQueries(api.lists.stats.pathFilter());
        queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter());
      },
    }),
  );
}

/** The lists with one moved, as lists.move leaves them. */
export function movedList(
  lists: ZBookmarkList[],
  move: { listId: string; parentId: string | null; index: number },
): ZBookmarkList[] {
  const siblings = lists
    .filter(
      (l) =>
        l.userRole === "owner" &&
        l.parentId === move.parentId &&
        l.id !== move.listId,
    )
    .sort((a, b) => b.position - a.position);
  const position = positionAmong(siblings, move.index);
  return lists.map((l) =>
    l.id === move.listId ? { ...l, parentId: move.parentId, position } : l,
  );
}

export function useMergeLists(
  opts?: Parameters<TRPCApi["lists"]["merge"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.merge.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        queryClient.invalidateQueries(api.lists.list.pathFilter());
        queryClient.invalidateQueries(
          api.bookmarks.getBookmarks.queryFilter({ listId: req.targetId }),
        );
        queryClient.invalidateQueries(
          api.bookmarks.getBookmarks.infiniteQueryFilter({
            listId: req.targetId,
          }),
        );
        queryClient.invalidateQueries(api.lists.stats.pathFilter());
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

export function useAddBookmarkToList(
  opts?: Parameters<TRPCApi["lists"]["addToList"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.addToList.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        scheduleInvalidateQueries(
          queryClient,
          api.bookmarks.getBookmarks.queryFilter({ listId: req.listId }),
        );
        scheduleInvalidateQueries(
          queryClient,
          api.bookmarks.getBookmarks.infiniteQueryFilter({
            listId: req.listId,
          }),
        );
        queryClient.invalidateQueries(
          api.lists.getListsOfBookmark.queryFilter({
            bookmarkId: req.bookmarkId,
          }),
        );
        scheduleInvalidateQueries(queryClient, api.lists.stats.pathFilter());
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

export function useRemoveBookmarkFromList(
  opts?: Parameters<TRPCApi["lists"]["removeFromList"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.removeFromList.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        scheduleInvalidateQueries(
          queryClient,
          api.bookmarks.getBookmarks.queryFilter({ listId: req.listId }),
        );
        scheduleInvalidateQueries(
          queryClient,
          api.bookmarks.getBookmarks.infiniteQueryFilter({
            listId: req.listId,
          }),
        );
        queryClient.invalidateQueries(
          api.lists.getListsOfBookmark.queryFilter({
            bookmarkId: req.bookmarkId,
          }),
        );
        scheduleInvalidateQueries(queryClient, api.lists.stats.pathFilter());
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

export function useDeleteBookmarkList(
  opts?: Parameters<TRPCApi["lists"]["delete"]["mutationOptions"]>[0],
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.lists.delete.mutationOptions({
      ...opts,
      onSuccess: (res, req, meta, context) => {
        queryClient.invalidateQueries(api.lists.list.pathFilter());
        queryClient.removeQueries(
          api.lists.get.queryFilter({ listId: req.listId }),
        );
        return opts?.onSuccess?.(res, req, meta, context);
      },
    }),
  );
}

export function useBookmarkLists(
  input?: Parameters<TRPCApi["lists"]["list"]["queryOptions"]>[0],
  opts?: Parameters<TRPCApi["lists"]["list"]["queryOptions"]>[1],
) {
  const api = useTRPC();
  return useQuery(
    api.lists.list.queryOptions(input, {
      ...opts,
      select: (data) => {
        return { data: data.lists, ...listsToTree(data.lists) };
      },
    }),
  );
}

export function augmentBookmarkListsWithInitialData(
  data:
    | {
        data: ZBookmarkList[];
        root: ZBookmarkListRoot;
        allPaths: ZBookmarkList[][];
        getPathById: (id: string) => ZBookmarkList[] | undefined;
      }
    | undefined,
  initialData: ZBookmarkList[],
) {
  if (data) {
    return data;
  }
  return { data: initialData, ...listsToTree(initialData) };
}
