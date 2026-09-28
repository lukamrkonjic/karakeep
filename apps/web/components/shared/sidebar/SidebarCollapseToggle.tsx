"use client";

import { useEffect, useState } from "react";
import {
  peekSidebarSoon,
  unpeekSidebarSoon,
  useSidebarCollapsed,
  useSidebarPeek,
  useToggleSidebarCollapsed,
} from "@/lib/sidebarCollapse";
import { cn, getOS } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

/**
 * The chevron in the header's logo block (HeaderLogo) that folds the
 * desktop sidebar in and out (see SidebarCollapseWrapper); ⌘B (Ctrl+B) does
 * the same from anywhere. With the sidebar folded, pointing at it with a
 * mouse peeks the sidebar in over the page. The logo itself links home.
 */
export default function SidebarCollapseToggle({
  className,
}: {
  className?: string;
}) {
  const collapsed = useSidebarCollapsed();
  const peeking = useSidebarPeek((s) => s.peeking) && collapsed;
  const toggle = useToggleSidebarCollapsed();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "b" &&
        // Bold, there.
        !(e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        e.preventDefault();
        if (!e.repeat) {
          toggle();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // After mounting: the server doesn't know the keyboard.
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(getOS() === "macos"), []);
  const label = collapsed ? "Show sidebar" : "Hide sidebar";

  return (
    <button
      type="button"
      onClick={toggle}
      onPointerEnter={(e) => {
        if (collapsed && e.pointerType === "mouse") {
          peekSidebarSoon();
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          unpeekSidebarSoon();
        }
      }}
      title={`${label} (${mac ? "⌘B" : "Ctrl+B"})`}
      aria-label={label}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        peeking && "bg-muted text-foreground",
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
