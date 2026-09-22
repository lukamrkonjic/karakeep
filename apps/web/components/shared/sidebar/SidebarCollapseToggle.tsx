"use client";

import { useEffect, useState } from "react";
import { useSidebarCollapse } from "@/lib/sidebarCollapse";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

/**
 * The small chevron beside the header logo that folds the desktop sidebar
 * in and out (see SidebarCollapseWrapper). The logo itself links home.
 */
export default function SidebarCollapseToggle() {
  // The stored state only exists in the browser, so render the server's
  // default until mounted rather than hydrate a different arrow.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const collapsed = useSidebarCollapse((s) => s.collapsed) && mounted;
  const toggle = useSidebarCollapse((s) => s.toggle);
  const label = collapsed ? "Show sidebar" : "Hide sidebar";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="ml-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
