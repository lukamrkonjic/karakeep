import { Fragment } from "react";
import { useTranslation } from "@/lib/i18n/client";
import { Separator } from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

import HighlightCard from "../highlights/HighlightCard";

export default function HighlightsBox({
  bookmarkId,
  readOnly,
}: {
  bookmarkId: string;
  readOnly: boolean;
}) {
  const api = useTRPC();
  const { t } = useTranslation();

  const { data: highlights, isPending: isLoading } = useQuery(
    api.highlights.getForBookmark.queryOptions({ bookmarkId }),
  );

  if (isLoading || !highlights || highlights?.highlights.length === 0) {
    return null;
  }

  // Fork: a plain section like the details panel's others (it used to
  // fold away).
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-foreground">
        {t("common.highlights")}
      </p>
      <div className="group flex flex-col text-sm">
        {highlights.highlights.map((highlight) => (
          <Fragment key={highlight.id}>
            <HighlightCard
              highlight={highlight}
              clickable
              readOnly={readOnly}
            />
            <Separator className="m-2 h-0.5 bg-gray-200 last:hidden" />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
