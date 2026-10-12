"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { projectPath, projectSummary, useProjects } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { MoreHorizontal, Plus } from "lucide-react";

import type { ZProject } from "@karakeep/shared/types/projects";

import { ProjectCover } from "./ProjectCover";
import { ProjectNameDialog } from "./ProjectDialogs";
import { ProjectOptions } from "./ProjectOptions";

function ProjectCard({ project }: { project: ZProject }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group relative">
      <Link
        href={projectPath(project.id)}
        className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ProjectCover
          cover={project.cover}
          className="aspect-[4/3] rounded-2xl transition-[filter] group-hover:brightness-95"
        />
        <div className="px-1 pt-2">
          <p className="truncate font-medium">{project.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {projectSummary(project)} ·{" "}
            {formatDistanceToNowStrict(project.updatedAt, { addSuffix: true })}
          </p>
        </div>
      </Link>
      <ProjectOptions project={project} onOpenChange={setMenuOpen}>
        <Button
          variant="secondary"
          size="none"
          aria-label={`${project.name} options`}
          title="Options"
          className={cn(
            "absolute right-2 top-2 size-8 rounded-full bg-background/80 shadow-sm backdrop-blur transition-opacity hover:bg-background",
            menuOpen
              ? "opacity-100"
              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </ProjectOptions>
    </div>
  );
}

/**
 * Fork: Projects (/dashboard/projects) — your boards, the last changed
 * first, each with its cover as Pinterest shows boards; New project makes
 * one and opens it.
 */
export default function ProjectsPage() {
  const { data, error } = useProjects();
  const [creating, setCreating] = useState(false);
  if (error) {
    throw error;
  }
  if (!data) {
    return <FullPageSpinner />;
  }
  const { projects } = data;
  return (
    <div className="flex flex-col gap-5">
      <ProjectNameDialog open={creating} setOpen={setCreating} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-2xl">Projects</p>
          <p className="text-sm text-muted-foreground">
            Boards to lay your pictures out on, apart from your lists.
          </p>
        </div>
        <Button className="shrink-0 gap-2" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New project
        </Button>
      </div>
      {projects.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-16 text-center transition-colors hover:bg-muted/50"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Plus className="size-5" />
          </span>
          <span className="font-medium">Make your first project</span>
          <span className="max-w-sm text-sm text-muted-foreground">
            A board for a game, a room, a look: bring pictures in from your
            lists, move them around, add notes, and keep it as your inspiration.
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
