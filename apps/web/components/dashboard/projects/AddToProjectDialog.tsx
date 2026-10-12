"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import LoadingSpinner from "@/components/ui/spinner";
import { projectSummary, useAddToProject, useProjects } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";

import type { ZProject } from "@karakeep/shared/types/projects";
import { useTRPC } from "@karakeep/shared-react/trpc";

import { ProjectCover } from "./ProjectCover";
import { ProjectNameDialog } from "./ProjectDialogs";

/**
 * Fork: Add to project — a picture's "…", or a selection's: your projects
 * (a tick on those a single picture is on already), or a new one. They go
 * to the right of what's on its board; the message after has Open.
 */
export function AddToProjectDialog({
  bookmarkIds,
  open,
  setOpen,
  onAdded,
}: {
  bookmarkIds: string[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onAdded?: () => void;
}) {
  const api = useTRPC();
  const { data } = useProjects();
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const single = bookmarkIds.length === 1 ? bookmarkIds[0] : null;
  const { data: on } = useQuery(
    api.projects.ofBookmark.queryOptions(
      { bookmarkId: single ?? "" },
      { enabled: open && !!single },
    ),
  );
  const add = useAddToProject({
    onSuccess: () => {
      setOpen(false);
      onAdded?.();
    },
  });
  const addTo = (project: ZProject) =>
    add.mutate({ projectId: project.id, bookmarkIds });

  const projects = (data?.projects ?? []).filter((p) =>
    p.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const count = bookmarkIds.length;

  return (
    <>
      <ProjectNameDialog
        open={creating}
        setOpen={setCreating}
        onCreated={addTo}
      />
      <Dialog
        // Out of the way while a new project is named, and while the
        // pictures go on to the board.
        open={open && !creating && !add.isPending}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setFilter("");
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col">
          <DialogHeader>
            <DialogTitle>
              {count === 1 ? "Add to project" : `Add ${count} to a project`}
            </DialogTitle>
            <DialogDescription>
              {count === 1
                ? "It goes on the project's board, and stays in its lists too."
                : "They go on the project's board, and stay in their lists too."}
            </DialogDescription>
          </DialogHeader>
          {(data?.projects.length ?? 0) > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a project"
                className="pl-8"
              />
            </div>
          )}
          <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed">
                <Plus className="size-4" />
              </span>
              <span className="font-medium">New project</span>
            </button>
            {!data ? (
              <div className="flex justify-center py-6">
                <LoadingSpinner />
              </div>
            ) : (
              projects.map((project) => {
                const there = !!on?.projectIds.includes(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    disabled={add.isPending}
                    onClick={() => addTo(project)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent disabled:opacity-60",
                      add.isPending &&
                        add.variables?.projectId === project.id &&
                        "bg-accent",
                    )}
                  >
                    <ProjectCover
                      cover={project.cover}
                      className="size-12 shrink-0 rounded-md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {project.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {there ? "On its board" : projectSummary(project)}
                      </span>
                    </span>
                    {there && (
                      <Check className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
