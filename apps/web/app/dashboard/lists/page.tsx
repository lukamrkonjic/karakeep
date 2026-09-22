import { cookies } from "next/headers";
import AllListsView from "@/components/dashboard/lists/AllListsView";
import { NewListButton } from "@/components/dashboard/lists/NewListButton";
import { PendingInvitationsCard } from "@/components/dashboard/lists/PendingInvitationsCard";
import { AllListsOptions } from "@/components/dashboard/PageOptions";
import { useTranslation } from "@/lib/i18n/server";
import {
  listSortOf,
  newShuffleSeed,
  PAGE_SORT_COOKIE,
  parsePageSorts,
} from "@/lib/pageSort";
import { api } from "@/server/api/client";

export default async function ListsPage() {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();
  const lists = await api.lists.list();
  const stats = await api.users.stats();
  // Fork: the "…" menu's order for this page (a cookie, so it loads sorted).
  const sort = listSortOf(
    parsePageSorts((await cookies()).get(PAGE_SORT_COOKIE)?.value),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl tracking-normal text-foreground">
            {t("lists.all_lists")}
          </h1>
          <p className="text-md text-muted-foreground">
            {t("lists.summary_list", { count: lists.lists.length })} ·{" "}
            {t("lists.summary_bookmark", { count: stats.numBookmarks })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NewListButton />
          <AllListsOptions variant="header" />
        </div>
      </div>
      <PendingInvitationsCard />
      <AllListsView
        archivedCount={stats.numArchived}
        favoritesCount={stats.numFavorites}
        initialData={lists.lists}
        sort={sort}
        seed={newShuffleSeed()}
      />
    </div>
  );
}
