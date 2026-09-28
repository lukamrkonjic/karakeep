"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  peekSidebarSoon,
  unpeekSidebar,
  unpeekSidebarSoon,
  useSidebarCollapsed,
  useSidebarPeek,
} from "@/lib/sidebarCollapse";
import { cn } from "@/lib/utils";

/**
 * Wraps the (server-rendered) sidebar so SidebarCollapseToggle's state can
 * fold it away — the width goes to 0 while the aside slides out with that
 * edge, rather than unmounting it, so the aside's own scroll position/state
 * survives a fold in/out.
 *
 * Fork: folded, it can peek (lib/sidebarCollapse.ts) — slid back in over the
 * page, which stays as wide as it is; the pointer leaving, a link in it, Esc
 * or a new page slide it away again.
 */
export default function SidebarCollapseWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = useSidebarCollapsed();
  const peeking = useSidebarPeek((s) => s.peeking) && collapsed;

  const pathname = usePathname();
  useEffect(() => unpeekSidebar(), [pathname, collapsed]);
  useEffect(() => {
    if (!peeking) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        unpeekSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peeking]);

  return (
    <div
      className={cn(
        "relative hidden flex-none transition-[width] duration-200 ease-in-out sm:flex",
        collapsed ? "w-0" : "w-60 xl:w-72",
      )}
    >
      {/* Over the page while it moves (z-40), so docking a peeking sidebar
          doesn't cut it off as the page makes room. Its slide keeps pace
          with the width above, so the two edges stay together. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- it only sees its links followed, which have keys of their own */}
      <div
        inert={collapsed && !peeking}
        onPointerEnter={(e) => {
          if (peeking && e.pointerType === "mouse") {
            peekSidebarSoon();
          }
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") {
            unpeekSidebarSoon();
          }
        }}
        onClick={(e) => {
          if (peeking && (e.target as Element).closest("a")) {
            unpeekSidebar();
          }
        }}
        className={cn(
          "z-40 flex w-60 shrink-0 bg-background transition-[transform,box-shadow] duration-200 ease-in-out xl:w-72",
          collapsed ? "absolute inset-y-0 left-0" : "relative",
          collapsed && !peeking && "-translate-x-full",
          peeking && "shadow-2xl ring-1 ring-border",
        )}
      >
        {children}
      </div>
    </div>
  );
}
