import type { Metadata } from "next";
import ProjectsPage from "@/components/dashboard/projects/ProjectsPage";

export const metadata: Metadata = {
  title: "Projects | vrana",
};

// Fork: boards to lay pictures out on, apart from the lists.
export default function Projects() {
  return <ProjectsPage />;
}
