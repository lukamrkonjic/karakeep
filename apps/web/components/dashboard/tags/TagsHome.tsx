"use client";

import AllTagsView from "@/components/dashboard/tags/AllTagsView";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { parseAsBoolean, useQueryState } from "nuqs";

import TagFilterView from "./TagFilterView";

/**
 * The Tags page: finding things by tag first (TagFilterView), with upstream's
 * tag management (create, merge, bulk delete) one click away.
 */
export default function TagsHome() {
  const [manage, setManage] = useQueryState(
    "manage",
    parseAsBoolean.withDefault(false),
  );

  if (!manage) {
    return <TagFilterView onManage={() => void setManage(true)} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => void setManage(null)}
      >
        <ArrowLeft className="mr-2 size-4" />
        Find by tags
      </Button>
      <AllTagsView />
    </div>
  );
}
