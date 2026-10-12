"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { projectPath } from "@/lib/projects";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";

import type { ZProject } from "@karakeep/shared/types/projects";

import { DeleteProjectDialog, ProjectNameDialog } from "./ProjectDialogs";

/**
 * Fork: a project's "…" — on its card, its sidebar row and its board:
 * Open (not on the board itself), Rename…, Delete….
 */
export function ProjectOptions({
  project,
  onBoard = false,
  onDeleted,
  onOpenChange,
  align = "end",
  children,
}: {
  project: ZProject;
  /** On its own board: no Open. */
  onBoard?: boolean;
  onDeleted?: () => void;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
  /** The button that opens it. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <ProjectNameDialog
        project={project}
        open={renaming}
        setOpen={setRenaming}
      />
      <DeleteProjectDialog
        project={project}
        open={deleting}
        setOpen={setDeleting}
        onDeleted={onDeleted}
      />
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {!onBoard && (
            <DropdownMenuItem
              className="flex gap-2"
              onClick={() => router.push(projectPath(project.id))}
            >
              <ExternalLink className="size-4" />
              <span>Open</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="flex gap-2"
            onClick={() => setRenaming(true)}
          >
            <Pencil className="size-4" />
            <span>Rename…</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex gap-2 text-destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2 className="size-4" />
            <span>Delete…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
