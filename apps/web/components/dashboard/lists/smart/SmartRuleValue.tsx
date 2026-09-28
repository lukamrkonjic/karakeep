"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";

import type { SmartValueKind } from "@karakeep/shared/smartListRules";
import { useTagAutocomplete } from "@karakeep/shared-react/hooks/tags";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";
import {
  PERIOD_UNITS,
  SMART_KINDS,
  smartField,
} from "@karakeep/shared/smartListRules";
import {
  COLOUR_FAMILIES,
  FAMILY_SWATCHES,
  isColourFamily,
  parseColourQuery,
} from "@karakeep/shared/utils/colours";

import { SmartListPicker } from "./SmartListPicker";

/**
 * Fork: a smart list rule's value — one input per kind of value
 * (SmartValueKind, packages/shared/smartListRules.ts). A new kind of value
 * gets its input here.
 */

const nameOf = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Popovers inside a dialog: the dialog's scroll lock eats their wheel. */
const keepWheel = (e: React.WheelEvent) => e.stopPropagation();

// Flat, like the rule's selects and inputs (over the outline variant).
const TRIGGER =
  "h-9 w-full justify-between border-0 bg-muted px-3 font-normal hover:bg-accent";

/** A tag by name: one of yours, or the words typed. */
function TagName({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 200);
  const { data: tags } = useTagAutocomplete({
    nameContains: debounced,
    select: (data) => data.tags,
    enabled: open,
  });
  const typed = search.trim();
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={TRIGGER}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || "Choose a tag"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-56 p-0"
        onWheel={keepWheel}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search tags…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup className="max-h-60 overflow-y-auto">
              {typed && !tags?.some((t) => t.name === typed) && (
                <CommandItem
                  value={`typed:${typed}`}
                  onSelect={() => pick(typed)}
                >
                  Use “{typed}”
                </CommandItem>
              )}
              {tags?.map((tag) => (
                <CommandItem
                  key={tag.id}
                  value={tag.id}
                  onSelect={() => pick(tag.name)}
                  className="cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      tag.name === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {tag.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Swatch({ colour, className }: { colour: string; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15",
        className,
      )}
      style={{
        backgroundColor: isColourFamily(colour)
          ? FAMILY_SWATCHES[colour]
          : colour,
      }}
    />
  );
}

/** A colour family (the colour page's chips) or a colour of your own. */
function Colour({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const colour = parseColourQuery(value);
  const own = colour && !isColourFamily(colour) ? colour : "#286ff0";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(TRIGGER, "justify-start gap-2")}
        >
          {colour ? (
            <>
              <Swatch colour={colour} className="size-4" />
              <span className="truncate">
                {isColourFamily(colour) ? nameOf(colour) : colour}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Choose a colour</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" onWheel={keepWheel}>
        <div className="grid grid-cols-7 gap-2">
          {COLOUR_FAMILIES.map((family) => (
            <button
              key={family}
              type="button"
              title={nameOf(family)}
              aria-label={nameOf(family)}
              onClick={() => {
                onChange(family);
                setOpen(false);
              }}
              className={cn(
                "size-7 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 dark:ring-white/15",
                colour === family &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: FAMILY_SWATCHES[family] }}
            />
          ))}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <span
            className="relative size-7 shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
            style={{ backgroundColor: own }}
          >
            <input
              type="color"
              value={own}
              onChange={(e) => onChange(e.target.value)}
              aria-label="A colour of your own"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </span>
          A colour of your own…
        </label>
      </PopoverContent>
    </Popover>
  );
}

function Choice({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { id: string; label: string }[];
  placeholder?: string;
}) {
  return (
    // "" is Radix's hidden native select changing its options, not a choice.
    <Select value={value || undefined} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "7d": a number of days, weeks, months or years. */
function Period({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const found = /^(\d*)([dwmy])$/.exec(value);
  const amount = found?.[1] ?? "";
  const unit = found?.[2] ?? "d";
  return (
    <div className="flex w-full gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={9999}
        value={amount}
        onChange={(e) =>
          onChange(`${e.target.value.replace(/\D/g, "").slice(0, 4)}${unit}`)
        }
        aria-label="How many"
        className="h-9 w-20 shrink-0 px-3"
      />
      <Choice
        value={unit}
        onChange={(u) => onChange(`${amount}${u}`)}
        options={PERIOD_UNITS}
      />
    </div>
  );
}

export function SmartRuleValue({
  field,
  kind,
  value,
  onChange,
  excludeListId,
}: {
  field: string;
  kind: SmartValueKind;
  value: string;
  onChange: (value: string) => void;
  /** The smart list being edited: not offered in a Lists rule. */
  excludeListId?: string;
}) {
  const placeholder = smartField(field)?.placeholder;
  switch (kind) {
    case "text":
      return (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 px-3"
        />
      );
    case "query": {
      const invalid =
        value.trim() !== "" &&
        smartField(field)?.toMatcher("matches", value) === null;
      return (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          title={
            invalid
              ? "Only conditions a list can keep to (tag:, is:fav, color:…) — no plain words"
              : undefined
          }
          className={cn(
            "h-9 px-3 font-mono text-xs",
            invalid && "ring-1 ring-destructive focus-visible:ring-destructive",
          )}
        />
      );
    }
    case "tag":
      return <TagName value={value} onChange={onChange} />;
    case "list":
      return (
        <SmartListPicker
          value={value}
          onChange={onChange}
          excludeListId={excludeListId}
          className={TRIGGER}
        />
      );
    case "colour":
      return <Colour value={value} onChange={onChange} />;
    case "kind":
      return <Choice value={value} onChange={onChange} options={SMART_KINDS} />;
    case "yesno":
      return (
        <Choice
          value={value}
          onChange={onChange}
          options={[
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ]}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Day"
          className="h-9 px-3 [color-scheme:light] dark:[color-scheme:dark]"
        />
      );
    case "period":
      return <Period value={value} onChange={onChange} />;
  }
}
