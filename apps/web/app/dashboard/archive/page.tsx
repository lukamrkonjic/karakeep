import type { Metadata } from "next";
import Bookmarks from "@/components/dashboard/bookmarks/Bookmarks";
import { BookmarkPageOptions } from "@/components/dashboard/PageOptions";
import InfoTooltip from "@/components/ui/info-tooltip";
import { useTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();
  return {
    title: `${t("common.archive")} | vrana`,
  };
}

function header() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex gap-2">
        <p className="text-2xl">Archive</p>
        <InfoTooltip size={17} className="my-auto" variant="explain">
          <p>Archived bookmarks won&apos;t appear in the homepage</p>
        </InfoTooltip>
      </div>
      <BookmarkPageOptions
        variant="header"
        label="Archive options"
        pageKey="archive"
      />
    </div>
  );
}

export default async function ArchivedBookmarkPage() {
  return (
    <Bookmarks
      header={header()}
      query={{ archived: true }}
      sortKey="archive"
      showEditorCard={true}
    />
  );
}
