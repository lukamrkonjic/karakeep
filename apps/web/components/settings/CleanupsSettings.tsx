"use client";

import { useEffect, useState } from "react";
import {
  DuplicatePictures,
  DuplicatePicturesSummary,
} from "@/components/dashboard/cleanups/DuplicatePictures";
import {
  ListSuggestions,
  ListSuggestionsSummary,
} from "@/components/dashboard/cleanups/ListSuggestions";
import { TagDuplicationDetection } from "@/components/dashboard/cleanups/TagDuplicationDetention";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ChevronRight, FolderInput, Images, Tags } from "lucide-react";

import { SettingsPage } from "./SettingsPage";

/**
 * Fork: Settings → Cleanups. Each kind of cleanup is a section of its own,
 * folded until it's opened (its heading says how much waits there), so a long
 * run of list suggestions no longer buries the duplicates under it.
 */

function Section({
  id,
  icon,
  title,
  summary,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Opened by a link to it (Settings → Pictures' "to review").
  useEffect(() => {
    if (window.location.hash === `#${id}`) {
      setOpen(true);
    }
  }, [id]);
  return (
    <Card id={id}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-5 py-4 text-left hover:bg-accent/40">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="flex items-center gap-2 text-base font-semibold [&>svg]:size-4">
            {icon}
            {title}
          </span>
          {summary && (
            <span className="ml-auto text-sm text-muted-foreground">
              {summary}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="px-5 pb-5">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function CleanupsSettings() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t("cleanups.cleanups")}>
      <div className="flex flex-col gap-3">
        <Section
          id="list-suggestions"
          icon={<FolderInput />}
          title="List suggestions"
          summary={<ListSuggestionsSummary />}
        >
          <ListSuggestions />
        </Section>
        <Section
          id="duplicate-pictures"
          icon={<Images />}
          title="Duplicate pictures"
          summary={<DuplicatePicturesSummary />}
        >
          <DuplicatePictures />
        </Section>
        <Section
          id="duplicate-tags"
          icon={<Tags />}
          title={t("cleanups.duplicate_tags.title")}
        >
          <TagDuplicationDetection />
        </Section>
      </div>
    </SettingsPage>
  );
}
