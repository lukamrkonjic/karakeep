"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isEmojiIcon } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { ZBookmarkList } from "@karakeep/shared/types/lists";

import NewBookmarkDialog from "../bookmarks/NewBookmarkDialog";
import { ListOptions } from "./ListOptions";
import {
  ListCollaboratorsIcons,
  ListPrivacyLabel,
} from "./ListHeaderComponents";
import { ListSubscriptionNote } from "./ListSubscriptionNote";

export default function ListHeader({
  initialData,
}: {
  initialData: ZBookmarkList;
}) {
  const api = useTRPC();
  const { t } = useTranslation();
  const router = useRouter();
  const { data: list, error } = useQuery(
    api.lists.get.queryOptions(
      {
        listId: initialData.id,
      },
      {
        initialData,
      },
    ),
  );

  const { data: statsData } = useQuery(
    api.lists.stats.queryOptions(undefined, {
      placeholderData: keepPreviousData,
    }),
  );
  const itemCount = statsData?.stats.get(list.id);

  if (error) {
    // This is usually exercised during list deletions.
    if (error.data?.code == "NOT_FOUND") {
      router.push("/dashboard/bookmarks");
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        {isEmojiIcon(list.icon) && (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl">
            {list.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold leading-tight">
            {list.name}
          </h1>
          {list.description && (
            <p className="mt-1 text-muted-foreground">{list.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {itemCount !== undefined && (
              <>
                <span>{t("lists.items_count", { count: itemCount })}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <ListPrivacyLabel list={list} />
            <ListSubscriptionNote list={list} />
            <ListCollaboratorsIcons list={list} />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {list.type === "manual" && <NewBookmarkDialog />}
        <ListOptions list={list}>
          <Button variant="ghost">
            <MoreHorizontal />
          </Button>
        </ListOptions>
      </div>
    </div>
  );
}
