"use client";

import { ButtonWithTooltip } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { useIsPhone } from "@/lib/hooks/useIsPhone";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  Settings,
} from "lucide-react";

import type { GuestViewPrefs } from "./useGuestViewPrefs";

/**
 * Fork: a guest's view options — as the app's own (ViewOptions): a gear that
 * opens columns (a slider, with its value and ends) and the order.
 */
export function GuestViewOptions({
  prefs,
  update,
  searching,
}: {
  prefs: GuestViewPrefs;
  update: (patch: Partial<GuestViewPrefs>) => void;
  /** Search results come best first; the order is for browsing. */
  searching: boolean;
}) {
  const isPhone = useIsPhone();
  const columns = isPhone ? prefs.phoneColumns : prefs.columns;
  const maxColumns = isPhone ? 4 : 8;
  const orders = [
    { key: "desc", label: "Newest first", icon: ArrowDownWideNarrow },
    { key: "asc", label: "Oldest first", icon: ArrowUpNarrowWide },
  ] as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ButtonWithTooltip
          tooltip="View options"
          delayDuration={100}
          variant="ghost"
        >
          <Settings size={18} />
        </ButtonWithTooltip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Columns</span>
            <span className="text-sm text-muted-foreground">{columns}</span>
          </div>
          <Slider
            value={[columns]}
            onValueChange={([value]) =>
              update(isPhone ? { phoneColumns: value } : { columns: value })
            }
            min={1}
            max={maxColumns}
            step={1}
            className="w-full"
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>1</span>
            <span>{maxColumns}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-sm font-semibold">
          Order
          {searching && (
            <span className="font-normal text-muted-foreground">
              {" "}
              — searches: best first
            </span>
          )}
        </div>
        {orders.map(({ key, label, icon: Icon }) => (
          <DropdownMenuItem
            key={key}
            className="cursor-pointer justify-between"
            onSelect={(e) => {
              e.preventDefault();
              update({ sortOrder: key });
            }}
          >
            <span className="flex items-center gap-2">
              <Icon size={18} />
              {label}
            </span>
            {prefs.sortOrder === key && <Check className="ml-2 size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
