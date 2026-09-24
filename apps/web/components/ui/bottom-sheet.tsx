"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";

/**
 * Fork: a panel that slides up from the bottom of a phone — the tab bar's
 * Lists and More, a bookmark's actions, the viewer's details. Closes on a tap
 * outside, Escape, or dragging it down by its top.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  showTitle = false,
  trigger,
  className,
  bodyClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read out by screen readers; shown when `showTitle`. */
  title: string;
  showTitle?: boolean;
  trigger?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  // How far the sheet has been dragged down by its handle.
  const [drag, setDrag] = React.useState(0);
  const start = React.useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current !== null) {
      setDrag(Math.max(0, e.touches[0].clientY - start.current));
    }
  };
  const onTouchEnd = () => {
    start.current = null;
    if (drag > 90) {
      onOpenChange(false);
    }
    setDrag(0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)] shadow-lg outline-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            className,
          )}
          style={
            drag
              ? { transform: `translateY(${drag}px)`, transition: "none" }
              : undefined
          }
        >
          <div
            className="shrink-0 touch-none"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <div className="mx-auto mb-2 mt-2.5 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            <DialogPrimitive.Title
              className={
                showTitle ? "px-5 pb-2 pt-1 text-base font-semibold" : "sr-only"
              }
            >
              {title}
            </DialogPrimitive.Title>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3",
              bodyClassName,
            )}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A row of a sheet's menu: an icon, a label, and the whole row to tap. */
export function SheetItem({
  icon,
  children,
  className,
  destructive,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] active:bg-muted disabled:opacity-50",
        destructive && "text-destructive",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
