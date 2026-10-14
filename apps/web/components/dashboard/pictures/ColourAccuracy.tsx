"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Target } from "lucide-react";

import { COLOUR_ACCURACY_DEFAULT } from "@karakeep/shared/utils/colours";

/**
 * Fork: how near a colour has to be to count (utils/colours.ts
 * COLOUR_ACCURACY_DEFAULT) — the colour pages', or a colour smart list's —
 * in a menu, as the main grid's view options size its columns. It changes
 * as the slider moves; what it shows follows.
 */
export function ColourAccuracy({
  value,
  onChange,
  family,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  /** A family's ("Red"): measured from its own colour, the chip's. */
  family?: string;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("shrink-0 gap-1.5 px-2 sm:gap-2 sm:px-3", className)}
          title="How close a colour has to be to count"
        >
          <Target className="size-4" />
          <span className="hidden sm:inline">Accuracy</span>
          <span className="tabular-nums text-muted-foreground">{value}%</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="px-2 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Colour accuracy</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {value}%
            </span>
          </div>
          <Slider
            value={[value]}
            onValueChange={([next]) => onChange(next)}
            min={0}
            max={100}
            step={5}
            thumbLabels={["Colour accuracy"]}
            className="w-full"
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>Looser</span>
            <span>Exact</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {family
              ? `How close to the chip's ${family.toLowerCase()} a picture's colours have to be. Looser takes in the colours next to it; exact keeps to the truest ${family.toLowerCase()}s.`
              : "How close a picture's colours have to be to this one. Looser takes in the shades around it; exact keeps to the colour itself."}
          </p>
        </div>
        {value !== COLOUR_ACCURACY_DEFAULT && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onChange(COLOUR_ACCURACY_DEFAULT);
              }}
            >
              Back to {COLOUR_ACCURACY_DEFAULT}%
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
