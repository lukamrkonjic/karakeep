import { and, count, countDistinct, eq, inArray } from "drizzle-orm";

import type { DB } from "@karakeep/db";
import {
  assets,
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  guestShareListsTable,
  guestSharesTable,
  users,
} from "@karakeep/db/schema";

/**
 * Fork: what a guest link lets its guest see (routers/guestShares.ts, and its
 * files: packages/api/routes/public/guestShares.ts) — the owner's bookmarks in
 * the lists ticked for it. Each list on its own: what's under a ticked list
 * isn't shown unless it's ticked too. Archived bookmarks only where the owner
 * shows them (Settings → Archived bookmarks).
 */
export interface GuestShareScope {
  shareId: string;
  userId: string;
  ownerName: string;
  showNotes: boolean;
  /** The owner's own manual lists ticked for the link. */
  listIds: string[];
  includeArchived: boolean;
}

/** The link this token is, or null: none (deleted, or its link was reset). */
export async function guestShareScope(
  db: DB,
  token: string,
): Promise<GuestShareScope | null> {
  const [share] = await db
    .select({
      id: guestSharesTable.id,
      userId: guestSharesTable.userId,
      showNotes: guestSharesTable.showNotes,
      ownerName: users.name,
      archiveDisplayBehaviour: users.archiveDisplayBehaviour,
    })
    .from(guestSharesTable)
    .innerJoin(users, eq(users.id, guestSharesTable.userId))
    .where(eq(guestSharesTable.token, token));
  if (!share) {
    return null;
  }
  const lists = await db
    .select({ id: bookmarkLists.id })
    .from(guestShareListsTable)
    .innerJoin(bookmarkLists, eq(bookmarkLists.id, guestShareListsTable.listId))
    .where(
      and(
        eq(guestShareListsTable.shareId, share.id),
        eq(bookmarkLists.userId, share.userId),
        eq(bookmarkLists.type, "manual"),
      ),
    );
  return {
    shareId: share.id,
    userId: share.userId,
    ownerName: share.ownerName,
    showNotes: share.showNotes,
    listIds: lists.map((l) => l.id),
    includeArchived: share.archiveDisplayBehaviour === "show",
  };
}

/** The bookmarks shown in these lists (a link's, by default). */
function shownIn(scope: GuestShareScope, listIds: string[]) {
  return and(
    inArray(bookmarksInLists.listId, listIds),
    eq(bookmarks.userId, scope.userId),
    scope.includeArchived ? undefined : eq(bookmarks.archived, false),
  );
}

/** Every bookmark shown in these of the link's lists, each once. */
export async function guestBookmarkIds(
  db: DB,
  scope: GuestShareScope,
  listIds: string[] = scope.listIds,
): Promise<string[]> {
  if (listIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinct({ id: bookmarksInLists.bookmarkId })
    .from(bookmarksInLists)
    .innerJoin(bookmarks, eq(bookmarks.id, bookmarksInLists.bookmarkId))
    .where(shownIn(scope, listIds));
  return rows.map((r) => r.id);
}

/** How many bookmarks each of the link's lists shows, and all of them. */
export async function guestListSizes(db: DB, scope: GuestShareScope) {
  if (scope.listIds.length === 0) {
    return { perList: new Map<string, number>(), total: 0 };
  }
  const [rows, [all]] = await Promise.all([
    db
      .select({ listId: bookmarksInLists.listId, n: count() })
      .from(bookmarksInLists)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarksInLists.bookmarkId))
      .where(shownIn(scope, scope.listIds))
      .groupBy(bookmarksInLists.listId),
    db
      .select({ n: countDistinct(bookmarksInLists.bookmarkId) })
      .from(bookmarksInLists)
      .innerJoin(bookmarks, eq(bookmarks.id, bookmarksInLists.bookmarkId))
      .where(shownIn(scope, scope.listIds)),
  ]);
  return {
    perList: new Map(rows.map((r) => [r.listId, r.n])),
    total: all?.n ?? 0,
  };
}

/** The link's lists this bookmark is in; none: the guest can't see it. */
export async function guestListsOf(
  db: DB,
  scope: GuestShareScope,
  bookmarkId: string,
): Promise<string[]> {
  if (scope.listIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ listId: bookmarksInLists.listId })
    .from(bookmarksInLists)
    .innerJoin(bookmarks, eq(bookmarks.id, bookmarksInLists.bookmarkId))
    .where(
      and(
        eq(bookmarksInLists.bookmarkId, bookmarkId),
        shownIn(scope, scope.listIds),
      ),
    );
  return rows.map((r) => r.listId);
}

/**
 * Whether the guest may have this file: one of a bookmark they can see (its
 * picture or video, a video's poster, a link's banner or screenshot…).
 */
export async function guestCanSeeAsset(
  db: DB,
  scope: GuestShareScope,
  assetId: string,
): Promise<boolean> {
  const [asset] = await db
    .select({ bookmarkId: assets.bookmarkId })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, scope.userId)));
  if (!asset?.bookmarkId) {
    return false;
  }
  return (await guestListsOf(db, scope, asset.bookmarkId)).length > 0;
}
