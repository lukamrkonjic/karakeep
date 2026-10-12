"use client";

import { useRef, useState } from "react";
import SidebarItem from "@/components/shared/sidebar/SidebarItem";
import { Button } from "@/components/ui/button";
import {
  draggedBookmarkCount,
  draggedBookmarkIds,
  isBookmarkDrag,
} from "@/lib/bookmark-drag";
import { projectPath, useAddToProject, useProjects } from "@/lib/projects";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { cn } from "@/lib/utils";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";

import type { ZProject } from "@karakeep/shared/types/projects";

import { ProjectNameDialog } from "./ProjectDialogs";
import { ProjectOptions } from "./ProjectOptions";

/**
 * A project as a place to drop bookmarks (from any grid, or a selection):
 * they're added to its board, to the right of what's there — "+ Add 3".
 */
function useProjectDrop(project: ZProject) {
  const [over, setOver] = useState(false);
  const [count, setCount] = useState(1);
  const depth = useRef(0);
  const { mutate: add } = useAddToProject();
  return {
    over,
    hint: count > 1 ? `+ Add ${count}` : "+ Add",
    onDragEnter: (e: React.DragEvent) => {
      if (!isBookmarkDrag(e)) {
        return;
      }
      e.preventDefault();
      depth.current++;
      setOver(true);
      setCount(draggedBookmarkCount());
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isBookmarkDrag(e)) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isBookmarkDrag(e)) {
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setOver(false);
      }
    },
    onDrop: (e: React.DragEvent) => {
      depth.current = 0;
      setOver(false);
      const ids = draggedBookmarkIds(e);
      if (ids.length === 0) {
        return;
      }
      e.preventDefault();
      add({ projectId: project.id, bookmarkIds: ids });
    },
  };
}

function ProjectRow({ project }: { project: ZProject }) {
  const drop = useProjectDrop(project);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <SidebarItem
      logo={null}
      name={project.name}
      path={projectPath(project.id)}
      className="group my-0.5"
      linkClassName="py-1.5 px-2"
      right={
        <ProjectOptions
          project={project}
          align="start"
          onOpenChange={setMenuOpen}
        >
          <Button
            size="none"
            variant="ghost"
            className="relative"
            aria-label={`${project.name} options`}
          >
            {/* Where a list's "…" and count sit, so they all line up. */}
            <MoreHorizontal
              className={cn(
                "absolute inset-y-0 right-2.5 my-auto size-4 transition-opacity duration-100 group-hover:opacity-100",
                menuOpen ? "opacity-100" : "opacity-0",
              )}
            />
            <span
              className={cn(
                "px-2.5 text-xs font-light text-muted-foreground transition-opacity duration-100 group-hover:opacity-0",
                menuOpen ? "opacity-0" : "opacity-100",
              )}
            >
              {project.numPictures}
            </span>
          </Button>
        </ProjectOptions>
      }
      dropHighlight={drop.over}
      dropHint={drop.hint}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    />
  );
}

/**
 * Fork: the sidebar's Projects — your boards, the last changed first, apart
 * from the lists; folds away like Smart lists. Pictures dragged onto one go
 * on its board. With no projects, just the heading and its +.
 */
export function ProjectsSidebarSection({
  spaceAbove,
}: {
  spaceAbove: boolean;
}) {
  const { data } = useProjects();
  const folded = !!usePreference("projectsFolded");
  const updatePreferences = useUpdatePreferences();
  const [creating, setCreating] = useState(false);
  const projects = data?.projects ?? [];
  return (
    <section aria-label="Projects">
      <ProjectNameDialog open={creating} setOpen={setCreating} />
      {spaceAbove && <div aria-hidden className="h-4" />}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background py-2">
        <button
          type="button"
          onClick={() => void updatePreferences({ projectsFolded: !folded })}
          aria-expanded={!folded}
          title={folded ? "Show projects" : "Hide projects"}
          className="group/heading flex items-center gap-1 rounded-md pl-2 pr-1 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          Projects
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              !folded && "rotate-90",
              folded
                ? "opacity-100"
                : "opacity-0 group-hover/heading:opacity-100",
            )}
          />
        </button>
        <div className="mr-1 flex items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            title="New project"
            aria-label="New project"
            onClick={() => setCreating(true)}
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {!folded && projects.length > 0 && (
        <ul>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}
    </section>
  );
}
