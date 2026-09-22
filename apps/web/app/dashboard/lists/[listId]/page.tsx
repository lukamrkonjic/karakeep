import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Bookmarks from "@/components/dashboard/bookmarks/Bookmarks";
import ListHeader from "@/components/dashboard/lists/ListHeader";
import ListSubfolders from "@/components/dashboard/lists/ListSubfolders";
import { parseSublists, SUBLISTS_COOKIE } from "@/lib/sublists";
import { api } from "@/server/api/client";
import { TRPCError } from "@trpc/server";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";

import { BookmarkListContextProvider } from "@karakeep/shared-react/hooks/bookmark-list-context";

export async function generateMetadata(props: {
  params: Promise<{ listId: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  try {
    const list = await api.lists.get({ listId: params.listId });
    return {
      title: `${list.name} | Karakeep`,
    };
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      notFound();
    }
    throw e;
  }
}

export default async function ListPage(props: {
  params: Promise<{ listId: string }>;
  searchParams?: Promise<{
    includeArchived?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const userSettings = await api.users.settings();
  let list;
  try {
    list = await api.lists.get({ listId: params.listId });
  } catch (e) {
    if (e instanceof TRPCError) {
      if (e.code == "NOT_FOUND") {
        notFound();
      }
    }
    throw e;
  }

  const includeArchived =
    searchParams?.includeArchived !== undefined
      ? searchParams.includeArchived === "true"
      : userSettings.archiveDisplayBehaviour === "show";

  // Only show editor card if user is owner or editor (not viewer)
  const canEdit = list.userRole === "owner" || list.userRole === "editor";

  // The "…" menu's sub-list toggle (a cookie, so this renders right the
  // first time): show everything nested under this list, not just its own.
  const archived = !includeArchived ? false : undefined;
  let query: Omit<
    ZGetBookmarksRequest,
    "sortOrder" | "sortBy" | "shuffleSeed" | "includeContent"
  > = {
    listId: list.id,
    archived,
  };
  const showSublists = parseSublists(
    (await cookies()).get(SUBLISTS_COOKIE)?.value,
  ).has(list.id);
  if (showSublists && list.type === "manual") {
    const { lists } = await api.lists.list();
    const children = new Map<string, string[]>();
    for (const l of lists) {
      if (l.parentId && l.type === "manual") {
        children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
      }
    }
    const walk = (id: string): string[] => [
      id,
      ...(children.get(id) ?? []).flatMap(walk),
    ];
    const ids = walk(list.id);
    if (ids.length > 1) {
      query = { listIds: ids, archived };
    }
  }

  return (
    <BookmarkListContextProvider list={list}>
      <Bookmarks
        query={query}
        sortKey={`list:${list.id}`}
        showEditorCard={list.type === "manual" && canEdit}
        header={
          <>
            <ListHeader initialData={list} />
            <ListSubfolders listId={list.id} />
          </>
        }
      />
    </BookmarkListContextProvider>
  );
}
