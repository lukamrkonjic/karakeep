"use client";

import {
  useSidebarCollapsed,
  useToggleSidebarCollapsed,
} from "@/lib/sidebarCollapse";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

/**
 * The small chevron at the right end of the header's logo block that folds
 * the desktop sidebar in and out (see SidebarCollapseWrapper). The logo
 * itself links home.
 */
export default function SidebarCollapseToggle({
  className,
}: {
  className?: string;
}) {
  const collapsed = useSidebarCollapsed();
  const toggle = useToggleSidebarCollapsed();
  const label = collapsed ? "Show sidebar" : "Hide sidebar";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <ChevronLeft
        className={cn(
          "size-4 transition-transform duration-200",
          collapsed && "rotate-180",
        )}
      />
    </button>
  );
}
