import type { Metadata } from "next";
import ProjectBoard from "@/components/dashboard/projects/board/ProjectBoard";
import { api } from "@/server/api/client";

import { tryCatch } from "@karakeep/shared/tryCatch";

export async function generateMetadata(props: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await props.params;
  const { data } = await tryCatch(api.projects.list());
  const name = data?.projects.find((p) => p.id === projectId)?.name;
  return { title: `${name ?? "Project"} | vrana` };
}

// Fork: a project's board.
export default async function ProjectPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  return <ProjectBoard projectId={projectId} />;
}
