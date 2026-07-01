"use client";

import { cn } from "@/lib/utils";
import { useSidebarCollapse } from "@/lib/sidebarCollapse";

/**
 * Wraps the (server-rendered) sidebar so SidebarCollapseToggle's state can
 * fold it away — collapsing the width to 0 with overflow clipped, rather
 * than unmounting it, so the aside's own scroll position/state survives a
 * fold in/out.
 */
export default function SidebarCollapseWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = useSidebarCollapse((s) => s.collapsed);

  return (
    <div
      className={cn(
        "hidden flex-none overflow-hidden transition-[width] duration-200 ease-in-out sm:flex",
        collapsed ? "w-0" : "w-60",
      )}
    >
      {children}
    </div>
  );
}
