"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast as sonner } from "sonner";

import type { ZProject } from "@karakeep/shared/types/projects";
import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: projects — boards to lay pictures out on, apart from the lists
 * (packages/trpc/routers/projects.ts). What the pages, the sidebar and the
 * pictures' "Add to project" share.
 */

export const projectPath = (projectId: string) =>
  `/dashboard/projects/${projectId}`;

/** "12 pictures · 3 notes", or "Empty". */
export function projectSummary(project: ZProject) {
  const parts = [
    project.numPictures > 0 &&
      `${project.numPictures} ${project.numPictures === 1 ? "picture" : "pictures"}`,
    project.numNotes > 0 &&
      `${project.numNotes} ${project.numNotes === 1 ? "note" : "notes"}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Empty";
}

export function useProjects() {
  const api = useTRPC();
  return useQuery(api.projects.list.queryOptions());
}

/** Everything a change to a project, or to what's on its board, touches. */
export function useRefreshProjects() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useCallback(
    (projectId?: string) =>
      Promise.all([
        queryClient.invalidateQueries(api.projects.list.pathFilter()),
        queryClient.invalidateQueries(api.projects.ofBookmark.pathFilter()),
        queryClient.invalidateQueries(
          projectId
            ? api.projects.get.queryFilter({ projectId })
            : api.projects.get.pathFilter(),
        ),
      ]),
    [api, queryClient],
  );
}

const onError = (e: { message: string }) => void sonner.error(e.message);

export function useCreateProject(opts?: {
  onSuccess?: (project: ZProject) => void;
}) {
  const api = useTRPC();
  const refresh = useRefreshProjects();
  return useMutation(
    api.projects.create.mutationOptions({
      onSuccess: (project) => {
        void refresh();
        opts?.onSuccess?.(project);
      },
      onError,
    }),
  );
}

export function useUpdateProject(opts?: {
  onSuccess?: (project: ZProject) => void;
}) {
  const api = useTRPC();
  const refresh = useRefreshProjects();
  return useMutation(
    api.projects.update.mutationOptions({
      onSuccess: (project) => {
        void refresh(project.id);
        opts?.onSuccess?.(project);
      },
      onError,
    }),
  );
}

export function useDeleteProject(opts?: { onSuccess?: () => void }) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.projects.delete.mutationOptions({
      onSuccess: (_, { projectId }) => {
        queryClient.removeQueries(api.projects.get.queryFilter({ projectId }));
        void queryClient.invalidateQueries(api.projects.list.pathFilter());
        void queryClient.invalidateQueries(
          api.projects.ofBookmark.pathFilter(),
        );
        opts?.onSuccess?.();
      },
      onError,
    }),
  );
}

/**
 * Puts bookmarks on a project's board (to the right of what's there, or
 * around `at`), then says so — with Open, unless it's the board you're on.
 */
export function useAddToProject(opts?: {
  /** No message: the board itself shows them arrive. */
  quiet?: boolean;
  onSuccess?: (result: {
    itemIds: string[];
    existingItemIds: string[];
    skipped: number;
  }) => void;
}) {
  const api = useTRPC();
  const router = useRouter();
  const refresh = useRefreshProjects();
  const queryClient = useQueryClient();
  return useMutation(
    api.projects.addBookmarks.mutationOptions({
      onSuccess: async (result, { projectId }) => {
        // Before the board reloads: it then knows what's arriving.
        opts?.onSuccess?.(result);
        await refresh(projectId);
        if (opts?.quiet) {
          return;
        }
        const name =
          queryClient
            .getQueryData(api.projects.list.queryKey())
            ?.projects.find((p) => p.id === projectId)?.name ?? "the project";
        const added = result.itemIds.length;
        const message =
          added > 0
            ? `Added ${added === 1 ? "it" : added} to ${name}`
            : result.existingItemIds.length > 0
              ? `Already on ${name}`
              : `Nothing to add to ${name}`;
        sonner(message, {
          action: {
            label: "Open",
            onClick: () => router.push(projectPath(projectId)),
          },
        });
      },
      onError,
    }),
  );
}
