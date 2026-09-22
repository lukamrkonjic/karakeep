"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";

import { PageOptions } from "../PageOptions";
import { BookmarkSortSubmenu } from "../sort/SortSubmenu";
import { TailoredFeedSettings } from "./TailoredFeedSettings";

/**
 * The tailored feed's "…" (sidebar and page header): pick its lists, and how
 * it's sorted — "Recently added" is when a bookmark last joined one of them.
 */
export function TailoredFeedOptions({
  variant,
}: {
  variant: "sidebar" | "header";
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <TailoredFeedSettings open={pickerOpen} setOpen={setPickerOpen} />
      <PageOptions
        variant={variant}
        label="Tailored feed options"
        items={[
          {
            id: "lists",
            label: "Choose lists…",
            icon: <ListChecks className="size-4" />,
            onSelect: () => setPickerOpen(true),
          },
        ]}
        sort={<BookmarkSortSubmenu pageKey="feed" withRecentlyAdded />}
      />
    </>
  );
}
