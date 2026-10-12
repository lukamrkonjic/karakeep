"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { ActionButton } from "@/components/ui/action-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  projectPath,
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
} from "@/lib/projects";

import type { ZProject } from "@karakeep/shared/types/projects";
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from "@karakeep/shared/types/projects";

/**
 * Fork: a project's name (and a line about it, if wanted) — making one, or
 * renaming it. A new project opens straight away, unless `onCreated` takes
 * it (Add to project makes one for the pictures in hand).
 */
export function ProjectNameDialog({
  project,
  open,
  setOpen,
  onCreated,
  children,
}: {
  /** Renames this one; without it, makes a new one. */
  project?: ZProject;
  open: boolean;
  setOpen: (open: boolean) => void;
  onCreated?: (project: ZProject) => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(project?.name ?? "");
      setDescription(project?.description ?? "");
    }
  }
  const create = useCreateProject({
    onSuccess: (created) => {
      setOpen(false);
      if (onCreated) {
        onCreated(created);
      } else {
        router.push(projectPath(created.id));
      }
    },
  });
  const update = useUpdateProject({ onSuccess: () => setOpen(false) });
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      return;
    }
    if (project) {
      update.mutate({
        projectId: project.id,
        name,
        description: description.trim() || null,
      });
    } else {
      create.mutate({ name, description: description.trim() || undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {project ? "Rename project" : "New project"}
            </DialogTitle>
            <DialogDescription>
              {project
                ? "Its board stays as it is."
                : "A board of its own to lay pictures out on — for a game, a room, a look. Pictures stay in their lists too."}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. Outpath"
            maxLength={MAX_PROJECT_NAME_LENGTH}
            aria-label="Name"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What it's for (if you like)"
            maxLength={MAX_PROJECT_DESCRIPTION_LENGTH}
            rows={2}
            aria-label="Description"
            className="resize-none"
          />
          <DialogFooter>
            <ActionButton
              type="submit"
              loading={pending}
              disabled={!name.trim()}
            >
              {project ? "Save" : "Make project"}
            </ActionButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes a project; its pictures stay where they are. */
export function DeleteProjectDialog({
  project,
  open,
  setOpen,
  onDeleted,
}: {
  project: ZProject;
  open: boolean;
  setOpen: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { mutate, isPending } = useDeleteProject({
    onSuccess: () => {
      setOpen(false);
      onDeleted?.();
    },
  });
  return (
    <ActionConfirmingDialog
      open={open}
      setOpen={setOpen}
      title={`Delete “${project.name}”?`}
      description={
        <p className="text-sm text-muted-foreground">
          Its board goes, with its notes. The pictures on it stay in your lists.
        </p>
      }
      actionButton={() => (
        <ActionButton
          type="button"
          variant="destructive"
          loading={isPending}
          onClick={() => mutate({ projectId: project.id })}
        >
          Delete
        </ActionButton>
      )}
    />
  );
}
