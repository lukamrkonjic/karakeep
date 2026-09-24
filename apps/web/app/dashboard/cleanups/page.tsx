import { DuplicatePictures } from "@/components/dashboard/cleanups/DuplicatePictures";
import { TagDuplicationDetection } from "@/components/dashboard/cleanups/TagDuplicationDetention";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "@/lib/i18n/server";
import { Images, Paintbrush, Tags } from "lucide-react";

export default async function Cleanups() {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();

  return (
    <div className="flex flex-col gap-y-4 rounded-md border bg-background p-4">
      <span className="flex items-center gap-1 text-2xl">
        <Paintbrush />
        {t("cleanups.cleanups")}
      </span>
      <Separator />
      {/* Fork: duplicate pictures, found nightly (DuplicatePictures.tsx). */}
      <span className="flex items-center gap-1 text-xl">
        <Images />
        Duplicate pictures
      </span>
      <Separator />
      <DuplicatePictures />
      <Separator />
      <span className="flex items-center gap-1 text-xl">
        <Tags />
        {t("cleanups.duplicate_tags.title")}
      </span>
      <Separator />
      <TagDuplicationDetection />
    </div>
  );
}
