import { TRPCError } from "@trpc/server";
import {
  and,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  notLike,
  or,
} from "drizzle-orm";

import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarkLinks,
  bookmarkLists,
  bookmarks,
  bookmarksInLists,
  bookmarkTags,
  picturePalettesTable,
  rssFeedImportsTable,
  rssFeedsTable,
  tagsOnBookmarks,
} from "@karakeep/db/schema";
import logger from "@karakeep/shared/logger";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { Matcher } from "@karakeep/shared/types/search";
import { colourQueryMatches } from "@karakeep/shared/utils/colours";
import { toAbsoluteDate } from "@karakeep/shared/utils/relativeDateUtils";

import { AuthedContext } from "..";
import { picturesShowing } from "./pictureText";

/**
 * Fork: how long a smart list's "Picture shows" waits for a new
 * description's fingerprint before answering without it (the next look has
 * it). The editor's count waits longer (routers/smartLists.ts).
 */
const SHOWS_WAIT_MS = 1500;

/** Fork: the user's bookmarks that are these (or, inverse, aren't). */
async function ownBookmarks(
  ctx: AuthedContext,
  ids: Iterable<string>,
  inverse: boolean,
): Promise<BookmarkQueryReturnType[]> {
  const matching = new Set(ids);
  const own = await ctx.db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(eq(bookmarks.userId, ctx.user.id));
  return own.filter((row) => matching.has(row.id) !== inverse);
}

interface BookmarkQueryReturnType {
  id: string;
}

function intersect(
  vals: BookmarkQueryReturnType[][],
): BookmarkQueryReturnType[] {
  if (!vals || vals.length === 0) {
    return [];
  }

  if (vals.length === 1) {
    return [...vals[0]];
  }

  const countMap = new Map<string, number>();
  const map = new Map<string, BookmarkQueryReturnType>();

  for (const arr of vals) {
    for (const item of arr) {
      countMap.set(item.id, (countMap.get(item.id) ?? 0) + 1);
      map.set(item.id, item);
    }
  }

  const result: BookmarkQueryReturnType[] = [];
  for (const [id, count] of countMap) {
    if (count === vals.length) {
      result.push(map.get(id)!);
    }
  }

  return result;
}

function union(vals: BookmarkQueryReturnType[][]): BookmarkQueryReturnType[] {
  if (!vals || vals.length === 0) {
    return [];
  }

  const uniqueIds = new Set<string>();
  const map = new Map<string, BookmarkQueryReturnType>();
  for (const arr of vals) {
    for (const item of arr) {
      uniqueIds.add(item.id);
      map.set(item.id, item);
    }
  }

  const result: BookmarkQueryReturnType[] = [];
  for (const id of uniqueIds) {
    result.push(map.get(id)!);
  }

  return result;
}

async function getIds(
  ctx: AuthedContext,
  matcher: Matcher,
  visitedListIds = new Set<string>(),
): Promise<BookmarkQueryReturnType[]> {
  const { db } = ctx;
  const userId = ctx.user.id;

  switch (matcher.type) {
    case "tagName": {
      if (!matcher.inverse) {
        return db
          .selectDistinct({ id: bookmarks.id })
          .from(bookmarkTags)
          .crossJoin(tagsOnBookmarks)
          .crossJoin(bookmarks)
          .where(
            and(
              eq(bookmarkTags.userId, userId),
              eq(bookmarkTags.name, matcher.tagName),
              eq(tagsOnBookmarks.tagId, bookmarkTags.id),
              eq(bookmarks.id, tagsOnBookmarks.bookmarkId),
              eq(bookmarks.userId, userId),
            ),
          );
      }

      const comp = matcher.inverse ? notExists : exists;
      return db
        .selectDistinct({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(
              db
                .select()
                .from(tagsOnBookmarks)
                .innerJoin(
                  bookmarkTags,
                  eq(tagsOnBookmarks.tagId, bookmarkTags.id),
                )
                .where(
                  and(
                    eq(tagsOnBookmarks.bookmarkId, bookmarks.id),
                    eq(bookmarkTags.userId, userId),
                    eq(bookmarkTags.name, matcher.tagName),
                  ),
                ),
            ),
          ),
        );
    }
    case "tagged": {
      const comp = matcher.tagged ? exists : notExists;
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(
              db
                .select()
                .from(tagsOnBookmarks)
                .where(and(eq(tagsOnBookmarks.bookmarkId, bookmarks.id))),
            ),
          ),
        );
    }
    case "listName": {
      // First, look up the list by name
      const lists = await db.query.bookmarkLists.findMany({
        where: and(
          eq(bookmarkLists.userId, userId),
          eq(bookmarkLists.name, matcher.listName),
        ),
      });

      if (lists.length === 0) {
        // No matching lists
        return [];
      }

      // Use List model to resolve list membership (manual and smart)
      // Import dynamically to avoid circular dependency
      const { List } = await import("../models/lists");
      const listBookmarkIds = [
        ...new Set(
          (
            await Promise.all(
              lists.map(async (list) => {
                const listModel = await List.fromId(ctx, list.id);
                return await listModel.getBookmarkIds(visitedListIds);
              }),
            )
          ).flat(),
        ),
      ];

      if (listBookmarkIds.length === 0) {
        if (matcher.inverse) {
          return db
            .selectDistinct({ id: bookmarks.id })
            .from(bookmarks)
            .where(eq(bookmarks.userId, userId));
        }
        return [];
      }

      return db
        .selectDistinct({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            matcher.inverse
              ? notInArray(bookmarks.id, listBookmarkIds)
              : inArray(bookmarks.id, listBookmarkIds),
          ),
        );
    }
    case "inlist": {
      const comp = matcher.inList ? exists : notExists;
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(
              db
                .select()
                .from(bookmarksInLists)
                .where(and(eq(bookmarksInLists.bookmarkId, bookmarks.id))),
            ),
          ),
        );
    }
    case "rssFeedName": {
      const comp = matcher.inverse ? notExists : exists;
      return db
        .selectDistinct({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(
              db
                .select()
                .from(rssFeedImportsTable)
                .innerJoin(
                  rssFeedsTable,
                  eq(rssFeedImportsTable.rssFeedId, rssFeedsTable.id),
                )
                .where(
                  and(
                    eq(rssFeedImportsTable.bookmarkId, bookmarks.id),
                    eq(rssFeedsTable.userId, userId),
                    eq(rssFeedsTable.name, matcher.feedName),
                  ),
                ),
            ),
          ),
        );
    }
    case "archived": {
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            eq(bookmarks.archived, matcher.archived),
          ),
        );
    }
    case "url": {
      const comp = matcher.inverse ? notLike : like;
      return db
        .select({ id: bookmarkLinks.id })
        .from(bookmarkLinks)
        .leftJoin(bookmarks, eq(bookmarks.id, bookmarkLinks.id))
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(bookmarkLinks.url, `%${matcher.url}%`),
          ),
        )
        .union(
          db
            .select({ id: bookmarkAssets.id })
            .from(bookmarkAssets)
            .leftJoin(bookmarks, eq(bookmarks.id, bookmarkAssets.id))
            .where(
              and(
                eq(bookmarks.userId, userId),
                // When a user is asking for a link, the inverse matcher should match only assets with URLs.
                isNotNull(bookmarkAssets.sourceUrl),
                comp(bookmarkAssets.sourceUrl, `%${matcher.url}%`),
              ),
            ),
        );
    }
    case "title": {
      const comp = matcher.inverse ? notLike : like;
      // Fork: an untitled picture or file is called by its file name.
      const untitled = or(isNull(bookmarks.title), eq(bookmarks.title, ""));
      if (matcher.inverse) {
        return db
          .select({ id: bookmarks.id })
          .from(bookmarks)
          .leftJoin(bookmarkLinks, eq(bookmarks.id, bookmarkLinks.id))
          .leftJoin(bookmarkAssets, eq(bookmarks.id, bookmarkAssets.id))
          .where(
            and(
              eq(bookmarks.userId, userId),
              or(
                isNull(bookmarks.title),
                comp(bookmarks.title, `%${matcher.title}%`),
              ),
              or(
                isNull(bookmarkLinks.title),
                comp(bookmarkLinks.title, `%${matcher.title}%`),
              ),
              or(
                isNull(bookmarkAssets.fileName),
                comp(bookmarkAssets.fileName, `%${matcher.title}%`),
                and(isNotNull(bookmarks.title), ne(bookmarks.title, "")),
              ),
            ),
          );
      }

      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(bookmarks.title, `%${matcher.title}%`),
          ),
        )
        .union(
          db
            .select({ id: bookmarkLinks.id })
            .from(bookmarkLinks)
            .leftJoin(bookmarks, eq(bookmarks.id, bookmarkLinks.id))
            .where(
              and(
                eq(bookmarks.userId, userId),
                comp(bookmarkLinks.title, `%${matcher.title}%`),
              ),
            ),
        )
        .union(
          db
            .select({ id: bookmarkAssets.id })
            .from(bookmarkAssets)
            .innerJoin(bookmarks, eq(bookmarks.id, bookmarkAssets.id))
            .where(
              and(
                eq(bookmarks.userId, userId),
                untitled,
                comp(bookmarkAssets.fileName, `%${matcher.title}%`),
              ),
            ),
        );
    }
    case "favourited": {
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            eq(bookmarks.favourited, matcher.favourited),
          ),
        );
    }
    case "dateAfter": {
      const comp = matcher.inverse ? lt : gte;
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(bookmarks.createdAt, matcher.dateAfter),
          ),
        );
    }
    case "dateBefore": {
      const comp = matcher.inverse ? gt : lte;
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(bookmarks.createdAt, matcher.dateBefore),
          ),
        );
    }
    case "age": {
      const comp = matcher.relativeDate.direction === "newer" ? gte : lt;
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(bookmarks.createdAt, toAbsoluteDate(matcher.relativeDate)),
          ),
        );
    }
    case "type": {
      const comp = matcher.inverse ? ne : eq;
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            comp(bookmarks.type, matcher.typeName),
          ),
        );
    }
    case "brokenLinks": {
      // Only applies to bookmarks of type LINK
      return db
        .select({ id: bookmarkLinks.id })
        .from(bookmarkLinks)
        .leftJoin(bookmarks, eq(bookmarks.id, bookmarkLinks.id))
        .where(
          and(
            eq(bookmarks.userId, userId),
            matcher.brokenLinks
              ? or(
                  eq(bookmarkLinks.crawlStatus, "failure"),
                  lt(bookmarkLinks.crawlStatusCode, 200),
                  gt(bookmarkLinks.crawlStatusCode, 299),
                )
              : and(
                  eq(bookmarkLinks.crawlStatus, "success"),
                  gte(bookmarkLinks.crawlStatusCode, 200),
                  lte(bookmarkLinks.crawlStatusCode, 299),
                ),
          ),
        );
    }
    case "source": {
      return db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            matcher.inverse
              ? or(
                  ne(bookmarks.source, matcher.source),
                  isNull(bookmarks.source),
                )
              : eq(bookmarks.source, matcher.source),
          ),
        );
    }
    // Fork: pictures by colour (their palettes, made by the workers).
    case "color": {
      const matching = new Set(
        (
          await db
            .select({
              id: picturePalettesTable.bookmarkId,
              colours: picturePalettesTable.colours,
            })
            .from(picturePalettesTable)
            .where(eq(picturePalettesTable.userId, userId))
        )
          .filter((row) => colourQueryMatches(row.colours ?? [], matcher.color))
          .map((row) => row.id),
      );
      if (!matcher.inverse) {
        return [...matching].map((id) => ({ id }));
      }
      return (
        await db
          .select({ id: bookmarks.id })
          .from(bookmarks)
          .where(eq(bookmarks.userId, userId))
      ).filter((row) => !matching.has(row.id));
    }
    // Fork: a list and every list under it, by id (smart list rules).
    case "listId": {
      const { List } = await import("../models/lists");
      let ids: string[] = [];
      try {
        const list = await List.fromId(ctx, matcher.listId);
        const lists = [list, ...(await list.getChildren())];
        ids = (
          await Promise.all(lists.map((l) => l.getBookmarkIds(visitedListIds)))
        ).flat();
      } catch (e) {
        // A list that's gone (or was never yours) holds nothing.
        if (!(e instanceof TRPCError && e.code === "NOT_FOUND")) {
          throw e;
        }
      }
      return ownBookmarks(ctx, ids, matcher.inverse);
    }
    // Fork: what it is, finer than link/text/media. A video is a video
    // bookmark or a note carrying one (how imported videos arrive), and such
    // a note is a video, not a note.
    case "kind": {
      const carriesVideo = exists(
        db
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.bookmarkId, bookmarks.id),
              eq(assets.assetType, AssetTypes.LINK_VIDEO),
            ),
          ),
      );
      const note = eq(bookmarks.type, BookmarkTypes.TEXT);
      const condition = {
        picture: eq(bookmarkAssets.assetType, "image"),
        pdf: eq(bookmarkAssets.assetType, "pdf"),
        video: or(
          eq(bookmarkAssets.assetType, "video"),
          and(note, carriesVideo),
        ),
        note: and(
          note,
          notExists(
            db
              .select({ id: assets.id })
              .from(assets)
              .where(
                and(
                  eq(assets.bookmarkId, bookmarks.id),
                  eq(assets.assetType, AssetTypes.LINK_VIDEO),
                ),
              ),
          ),
        ),
      }[matcher.kind];
      const matching = await db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .leftJoin(bookmarkAssets, eq(bookmarkAssets.id, bookmarks.id))
        .where(and(eq(bookmarks.userId, userId), condition));
      return matcher.inverse
        ? ownBookmarks(
            ctx,
            matching.map((row) => row.id),
            true,
          )
        : matching;
    }
    // Fork: pictures that show what the words describe (the picture model).
    // While a new description's fingerprint is being made, nothing does.
    case "shows": {
      let showing: string[] | null = null;
      try {
        showing = await picturesShowing(
          ctx,
          matcher.description,
          SHOWS_WAIT_MS,
        );
      } catch (e) {
        logger.warn(`[search] "Picture shows" couldn't be answered: ${e}`);
      }
      return ownBookmarks(ctx, showing ?? [], matcher.inverse);
    }
    case "and": {
      const vals = await Promise.all(
        matcher.matchers.map((m) => getIds(ctx, m, visitedListIds)),
      );
      return intersect(vals);
    }
    case "or": {
      const vals = await Promise.all(
        matcher.matchers.map((m) => getIds(ctx, m, visitedListIds)),
      );
      return union(vals);
    }
    default: {
      const _exhaustiveCheck: never = matcher;
      throw new Error("Unknown matcher type");
    }
  }
}

export async function getBookmarkIdsFromMatcher(
  ctx: AuthedContext,
  matcher: Matcher,
  visitedListIds = new Set<string>(),
): Promise<string[]> {
  const results = await getIds(ctx, matcher, visitedListIds);
  return results.map((r) => r.id);
}
