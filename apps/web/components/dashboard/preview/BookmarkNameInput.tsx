"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui/sonner";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { useUpdateBookmark } from "@karakeep/shared-react/hooks/bookmarks";
import { getBookmarkTitle } from "@karakeep/shared/utils/bookmarkUtils";

/**
 * Fork: the details panel's name, the way Eagle has it — an input already
 * holding the bookmark's title (or its file name; for a note carrying a
 * video, the video's), saved when you leave it or press Enter. Emptied, the
 * bookmark goes back to its own title.
 */
export function BookmarkNameInput({
  bookmark,
  readOnly = false,
}: {
  bookmark: ZBookmark;
  readOnly?: boolean;
}) {
  const videoFile =
    bookmark.content.type === BookmarkTypes.TEXT
      ? bookmark.assets.find((a) => a.assetType === "video")?.fileName
      : undefined;
  const shown = getBookmarkTitle(bookmark) ?? videoFile ?? "";
  const [value, setValue] = useState(shown);
  // Renamed elsewhere (or refetched): show that.
  useEffect(() => setValue(shown), [shown]);

  const { mutate } = useUpdateBookmark({
    onError: () => {
      toast({
        variant: "destructive",
        description: "Something went wrong while renaming it",
      });
      setValue(shown);
    },
  });

  const save = () => {
    const next = value.trim();
    if (next === shown.trim()) {
      setValue(shown);
      return;
    }
    mutate({ bookmarkId: bookmark.id, title: next === "" ? null : next });
  };

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      readOnly={readOnly}
      aria-label="Name"
      title={shown}
      placeholder="Untitled"
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
  );
}
