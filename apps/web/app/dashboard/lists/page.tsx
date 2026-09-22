import AllListsView from "@/components/dashboard/lists/AllListsView";
import { NewListButton } from "@/components/dashboard/lists/NewListButton";
import { PendingInvitationsCard } from "@/components/dashboard/lists/PendingInvitationsCard";
import { useTranslation } from "@/lib/i18n/server";
import { api } from "@/server/api/client";

export default async function ListsPage() {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();
  const lists = await api.lists.list();
  const stats = await api.users.stats();

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
        </div>
      </div>
      <PendingInvitationsCard />
      <AllListsView
        archivedCount={stats.numArchived}
        favoritesCount={stats.numFavorites}
        initialData={lists.lists}
      />
    </div>
  );
}
