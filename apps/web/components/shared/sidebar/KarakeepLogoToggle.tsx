"use client";

import KarakeepLogo from "@/components/KarakeepIcon";
import { useSidebarCollapse } from "@/lib/sidebarCollapse";

/**
 * The header logo doubles as the sidebar fold in/out toggle (see
 * SidebarCollapseWrapper) — no longer a link back to the home page.
 */
export default function KarakeepLogoToggle() {
  const collapsed = useSidebarCollapse((s) => s.collapsed);
  const toggle = useSidebarCollapse((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="transition-opacity hover:opacity-70"
    >
      <KarakeepLogo height={38} />
    </button>
  );
}
