import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";

import type {
  ZProject,
  ZProjectCover,
  ZProjectItem,
} from "@karakeep/shared/types/projects";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
  pictureEmbeddingsTable,
  picturePalettesTable,
  projectItemsTable,
  projectsTable,
} from "@karakeep/db/schema";
import { placeNew } from "@karakeep/shared/projectLayout";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";
import {
  MAX_PROJECT_ITEMS,
  zAddToProjectSchema,
  zEditProjectSchema,
  zNewProjectSchema,
  zProjectItemSchema,
  zProjectSchema,
  zSaveProjectItemsSchema,
} from "@karakeep/shared/types/projects";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { Bookmark } from "../models/bookmarks";

/**
 * Fork: projects — boards to lay pictures out on, apart from the lists, as
 * Pinterest keeps boards (packages/shared/types/projects.ts). Each is the
 * owner's alone. The board (apps/web/components/dashboard/projects/) moves
 * things itself and saves them in batches (saveItems); pictures added from
 * elsewhere — a picture's "…", a selection, a drop on the sidebar — are
 * placed here (addBookmarks), to the right of what's on it.
 */

const projectsProcedure = createScopedAuthedProcedure("lists");

/** How many pictures are tried for a cover (some have none to show). */
const COVER_CANDIDATES = 8;
const COVER_SIZE = 3;

type ProjectRow = typeof projectsTable.$inferSelect;
type ItemRow = typeof projectItemsTable.$inferSelect;

async function ownProject(
  ctx: AuthedContext,
  projectId: string,
): Promise<ProjectRow> {
  const project = await ctx.db.query.projectsTable.findFirst({
    where: and(
      eq(projectsTable.id, projectId),
      eq(projectsTable.userId, ctx.user.id),
    ),
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project;
}

/** A change to a project or its board: it goes to the top. */
async function touch(ctx: AuthedContext, projectId: string) {
  await ctx.db
    .update(projectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId));
}

/**
 * The picture each bookmark shows, if any: a picture's own file, a video's
 * first frame, or a link's banner (else its screenshot).
 */
async function picturesOf(
  ctx: AuthedContext,
  bookmarkIds: string[],
): Promise<Map<string, ZProjectCover>> {
  const out = new Map<string, ZProjectCover>();
  if (bookmarkIds.length === 0) {
    return out;
  }
  const own = await ctx.db
    .select({ id: bookmarkAssets.id, assetId: bookmarkAssets.assetId })
    .from(bookmarkAssets)
    .innerJoin(bookmarks, eq(bookmarks.id, bookmarkAssets.id))
    .where(
      and(
        eq(bookmarks.userId, ctx.user.id),
        inArray(bookmarkAssets.id, bookmarkIds),
        eq(bookmarkAssets.assetType, "image"),
      ),
    );
  for (const row of own) {
    out.set(row.id, { assetId: row.assetId, video: false });
  }
  const rank = [
    AssetTypes.LINK_VIDEO_THUMBNAIL,
    AssetTypes.LINK_BANNER_IMAGE,
    AssetTypes.LINK_SCREENSHOT,
  ];
  const others = await ctx.db
    .select({
      bookmarkId: assets.bookmarkId,
      assetId: assets.id,
      assetType: assets.assetType,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, ctx.user.id),
        inArray(assets.bookmarkId, bookmarkIds),
        inArray(assets.assetType, rank),
      ),
    );
  others.sort((a, b) => rank.indexOf(a.assetType) - rank.indexOf(b.assetType));
  for (const row of others) {
    if (row.bookmarkId && !out.has(row.bookmarkId)) {
      out.set(row.bookmarkId, {
        assetId: row.assetId,
        video: row.assetType === AssetTypes.LINK_VIDEO_THUMBNAIL,
      });
    }
  }
  return out;
}

/** The projects as the app shows them: counts, and a cover each. */
async function describe(
  ctx: AuthedContext,
  projects: ProjectRow[],
): Promise<ZProject[]> {
  if (projects.length === 0) {
    return [];
  }
  const ids = projects.map((p) => p.id);
  const counts = await ctx.db
    .select({
      projectId: projectItemsTable.projectId,
      kind: projectItemsTable.kind,
      n: count(),
    })
    .from(projectItemsTable)
    .where(inArray(projectItemsTable.projectId, ids))
    .groupBy(projectItemsTable.projectId, projectItemsTable.kind);
  // The biggest pictures on each board make its cover.
  const pictureItems = await ctx.db
    .select({
      projectId: projectItemsTable.projectId,
      bookmarkId: projectItemsTable.bookmarkId,
      area: sql<number>`${projectItemsTable.w} * ${projectItemsTable.h}`,
    })
    .from(projectItemsTable)
    .where(
      and(
        inArray(projectItemsTable.projectId, ids),
        eq(projectItemsTable.kind, "bookmark"),
      ),
    );
  const candidates = new Map<string, string[]>();
  for (const id of ids) {
    candidates.set(
      id,
      pictureItems
        .filter((i) => i.projectId === id && i.bookmarkId)
        .sort((a, b) => b.area - a.area)
        .slice(0, COVER_CANDIDATES)
        .map((i) => i.bookmarkId!),
    );
  }
  const pictures = await picturesOf(ctx, [...candidates.values()].flat());
  const numOf = (projectId: string, kind: ItemRow["kind"]) =>
    counts.find((c) => c.projectId === projectId && c.kind === kind)?.n ?? 0;
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    numPictures: numOf(p.id, "bookmark"),
    numNotes: numOf(p.id, "note"),
    cover: (candidates.get(p.id) ?? [])
      .flatMap((bookmarkId) => {
        const picture = pictures.get(bookmarkId);
        return picture ? [picture] : [];
      })
      .slice(0, COVER_SIZE),
  }));
}

function itemOf(row: ItemRow): ZProjectItem {
  return {
    id: row.id,
    kind: row.kind,
    bookmarkId: row.bookmarkId,
    text: row.text,
    style: row.style ?? null,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    z: row.z,
  };
}

/** Which of these bookmarks are the user's own. */
async function ownBookmarkIds(ctx: AuthedContext, ids: string[]) {
  if (ids.length === 0) {
    return new Set<string>();
  }
  const rows = await ctx.db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, ctx.user.id), inArray(bookmarks.id, ids)));
  return new Set(rows.map((r) => r.id));
}

export const projectsAppRouter = router({
  /** The user's projects, the last changed first. */
  list: projectsProcedure
    .output(z.object({ projects: z.array(zProjectSchema) }))
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.userId, ctx.user.id))
        .orderBy(desc(projectsTable.updatedAt), desc(projectsTable.createdAt));
      return { projects: await describe(ctx, rows) };
    }),

  /**
   * A project and its board: every item, the bookmarks its pictures are,
   * and what's known of them — their sizes and colours.
   */
  get: projectsProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.object({
        project: zProjectSchema,
        items: z.array(zProjectItemSchema),
        bookmarks: z.array(zBookmarkSchema),
        sizes: z.record(z.string(), z.object({ w: z.number(), h: z.number() })),
        colours: z.record(
          z.string(),
          z.array(z.object({ hex: z.string(), share: z.number() })),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ownProject(ctx, input.projectId);
      const rows = await ctx.db
        .select()
        .from(projectItemsTable)
        .where(eq(projectItemsTable.projectId, project.id));
      const bookmarkIds = rows.flatMap((r) =>
        r.bookmarkId ? [r.bookmarkId] : [],
      );
      const { bookmarks: loaded } = await Bookmark.loadMulti(ctx, {
        ids: bookmarkIds,
        includeContent: false,
        sortOrder: "desc",
      });
      const sizes: Record<string, { w: number; h: number }> = {};
      const colours: Record<string, { hex: string; share: number }[]> = {};
      if (bookmarkIds.length > 0) {
        const known = await ctx.db
          .select({
            bookmarkId: pictureEmbeddingsTable.bookmarkId,
            width: pictureEmbeddingsTable.width,
            height: pictureEmbeddingsTable.height,
          })
          .from(pictureEmbeddingsTable)
          .where(
            and(
              eq(pictureEmbeddingsTable.userId, ctx.user.id),
              inArray(pictureEmbeddingsTable.bookmarkId, bookmarkIds),
            ),
          );
        for (const row of known) {
          if (row.width && row.height) {
            sizes[row.bookmarkId] = { w: row.width, h: row.height };
          }
        }
        const palettes = await ctx.db
          .select({
            bookmarkId: picturePalettesTable.bookmarkId,
            colours: picturePalettesTable.colours,
          })
          .from(picturePalettesTable)
          .where(
            and(
              eq(picturePalettesTable.userId, ctx.user.id),
              inArray(picturePalettesTable.bookmarkId, bookmarkIds),
            ),
          );
        for (const row of palettes) {
          if (row.colours && row.colours.length > 0) {
            colours[row.bookmarkId] = row.colours;
          }
        }
      }
      const [described] = await describe(ctx, [project]);
      return {
        project: described,
        items: rows.map(itemOf),
        bookmarks: loaded.map((b) => b.asZBookmark()),
        sizes,
        colours,
      };
    }),

  create: projectsProcedure
    .input(zNewProjectSchema)
    .output(zProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(projectsTable)
        .values({
          userId: ctx.user.id,
          name: input.name,
          description: input.description || null,
        })
        .returning();
      const [described] = await describe(ctx, [row]);
      return described;
    }),

  /** Renames it, or changes its description (null clears it). */
  update: projectsProcedure
    .input(zEditProjectSchema)
    .output(zProjectSchema)
    .mutation(async ({ ctx, input }) => {
      await ownProject(ctx, input.projectId);
      const [row] = await ctx.db
        .update(projectsTable)
        .set({
          name: input.name,
          description:
            input.description === undefined
              ? undefined
              : input.description || null,
          updatedAt: new Date(),
        })
        .where(eq(projectsTable.id, input.projectId))
        .returning();
      const [described] = await describe(ctx, [row]);
      return described;
    }),

  /** The project and its board; its pictures stay where they are. */
  delete: projectsProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ownProject(ctx, input.projectId);
      await ctx.db
        .delete(projectsTable)
        .where(
          and(
            eq(projectsTable.id, input.projectId),
            eq(projectsTable.userId, ctx.user.id),
          ),
        );
    }),

  /** The projects a bookmark is on (a picture's "Add to project"). */
  ofBookmark: projectsProcedure
    .input(z.object({ bookmarkId: z.string() }))
    .output(z.object({ projectIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ projectId: projectItemsTable.projectId })
        .from(projectItemsTable)
        .innerJoin(
          projectsTable,
          eq(projectsTable.id, projectItemsTable.projectId),
        )
        .where(
          and(
            eq(projectsTable.userId, ctx.user.id),
            eq(projectItemsTable.bookmarkId, input.bookmarkId),
          ),
        );
      return { projectIds: rows.map((r) => r.projectId) };
    }),

  /**
   * Puts pictures on the board: around `at`, or to the right of what's on
   * it. One already there stays where it is (its item comes back as
   * `existingItemIds`); one that isn't the user's is skipped.
   */
  addBookmarks: projectsProcedure
    .input(zAddToProjectSchema)
    .output(
      z.object({
        itemIds: z.array(z.string()),
        existingItemIds: z.array(z.string()),
        skipped: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ownProject(ctx, input.projectId);
      const wanted = [...new Set(input.bookmarkIds)];
      const own = await ownBookmarkIds(ctx, wanted);
      const rows = await ctx.db
        .select()
        .from(projectItemsTable)
        .where(eq(projectItemsTable.projectId, project.id));
      const onBoard = new Map(
        rows.flatMap((r) => (r.bookmarkId ? [[r.bookmarkId, r.id]] : [])),
      );
      const fresh = wanted.filter((id) => own.has(id) && !onBoard.has(id));
      const existingItemIds = wanted.flatMap((id) => {
        const itemId = onBoard.get(id);
        return itemId ? [itemId] : [];
      });
      const skipped = wanted.length - fresh.length - existingItemIds.length;
      if (fresh.length === 0) {
        return { itemIds: [], existingItemIds, skipped };
      }
      if (rows.length + fresh.length > MAX_PROJECT_ITEMS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A project holds up to ${MAX_PROJECT_ITEMS} things`,
        });
      }
      // Their shapes: what the client saw, else what the picture index read.
      const known = await ctx.db
        .select({
          bookmarkId: pictureEmbeddingsTable.bookmarkId,
          width: pictureEmbeddingsTable.width,
          height: pictureEmbeddingsTable.height,
        })
        .from(pictureEmbeddingsTable)
        .where(
          and(
            eq(pictureEmbeddingsTable.userId, ctx.user.id),
            inArray(pictureEmbeddingsTable.bookmarkId, fresh),
          ),
        );
      const sizeOf = (id: string) => {
        const seen = input.sizes?.[id];
        if (seen) {
          return seen;
        }
        const row = known.find((k) => k.bookmarkId === id);
        return row?.width && row.height
          ? { w: row.width, h: row.height }
          : { w: 0, h: 0 };
      };
      const placed = placeNew(rows, fresh.map(sizeOf), input.at);
      const [{ top }] = await ctx.db
        .select({ top: max(projectItemsTable.z) })
        .from(projectItemsTable)
        .where(eq(projectItemsTable.projectId, project.id));
      const inserted = await ctx.db
        .insert(projectItemsTable)
        .values(
          fresh.map((bookmarkId, i) => ({
            projectId: project.id,
            kind: "bookmark" as const,
            bookmarkId,
            ...placed[i],
            z: (top ?? 0) + 1 + i,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: projectItemsTable.id });
      await touch(ctx, project.id);
      return {
        itemIds: inserted.map((r) => r.id),
        existingItemIds,
        skipped,
      };
    }),

  /**
   * The board's own changes, in a batch: items added or changed (whole)
   * and items taken off. A picture has to be the user's, and on the board
   * once; an item of another project's can't be touched.
   */
  saveItems: projectsProcedure
    .input(zSaveProjectItemsSchema)
    .output(z.object({ saved: z.number(), removed: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ownProject(ctx, input.projectId);
      const upsert = [...new Map(input.upsert.map((i) => [i.id, i])).values()];
      const ids = upsert.map((i) => i.id);
      const elsewhere =
        ids.length > 0
          ? await ctx.db
              .select({ id: projectItemsTable.id })
              .from(projectItemsTable)
              .where(
                and(
                  inArray(projectItemsTable.id, ids),
                  sql`${projectItemsTable.projectId} != ${project.id}`,
                ),
              )
          : [];
      if (elsewhere.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An item belongs to another project",
        });
      }
      for (const item of upsert) {
        const ok =
          item.kind === "bookmark"
            ? !!item.bookmarkId && item.text === null && item.style === null
            : item.bookmarkId === null &&
              item.text !== null &&
              item.style !== null;
        if (!ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A picture has a bookmark; a note has words and a look",
          });
        }
      }
      const own = await ownBookmarkIds(
        ctx,
        upsert.flatMap((i) => (i.bookmarkId ? [i.bookmarkId] : [])),
      );
      const rows = await ctx.db
        .select({
          id: projectItemsTable.id,
          bookmarkId: projectItemsTable.bookmarkId,
        })
        .from(projectItemsTable)
        .where(eq(projectItemsTable.projectId, project.id));
      const removing = new Set(input.remove);
      // A picture already on the board as another item (added meanwhile,
      // elsewhere) isn't put on it twice.
      const itemOfBookmark = new Map(
        rows
          .filter((r) => r.bookmarkId && !removing.has(r.id))
          .map((r) => [r.bookmarkId!, r.id]),
      );
      const accepted = upsert.filter(
        (i) =>
          i.kind === "note" ||
          (own.has(i.bookmarkId!) &&
            (itemOfBookmark.get(i.bookmarkId!) ?? i.id) === i.id),
      );
      const kept = new Set(
        rows.filter((r) => !removing.has(r.id)).map((r) => r.id),
      );
      accepted.forEach((i) => kept.add(i.id));
      if (kept.size > MAX_PROJECT_ITEMS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A project holds up to ${MAX_PROJECT_ITEMS} things`,
        });
      }
      let removed = 0;
      ctx.db.transaction((tx) => {
        if (input.remove.length > 0) {
          removed = tx
            .delete(projectItemsTable)
            .where(
              and(
                eq(projectItemsTable.projectId, project.id),
                inArray(projectItemsTable.id, input.remove),
              ),
            )
            .run().changes;
        }
        for (const item of accepted) {
          const box = {
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
            z: item.z,
            text: item.text,
            style: item.style,
          };
          tx.insert(projectItemsTable)
            .values({
              id: item.id,
              projectId: project.id,
              kind: item.kind,
              bookmarkId: item.bookmarkId,
              ...box,
            })
            .onConflictDoUpdate({ target: projectItemsTable.id, set: box })
            .run();
        }
        tx.update(projectsTable)
          .set({ updatedAt: new Date() })
          .where(eq(projectsTable.id, project.id))
          .run();
      });
      return { saved: accepted.length, removed };
    }),
});
