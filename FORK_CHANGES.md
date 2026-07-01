# Fork Changes & Merge Guide

This file catalogues every change this fork has made on top of upstream
[karakeep-app/karakeep](https://github.com/karakeep-app/karakeep), so that
pulling in upstream updates is easy to reason about and merge conflicts are
quick to resolve.

## TL;DR — how updatable is this fork?

**Very.** Of the ~42 changed files:

- **8 are brand-new files.** Upstream will never touch these, so they can
  never conflict.
- **~20 are small, targeted edits** (a handful of lines each — removing a
  border class, dropping a prop, adding one line). If upstream changes a
  *different* part of the same file, git merges these automatically; if it
  touches the exact same line, the conflict is a one-glance fix.
- **~8 files were substantially reworked** and are the real conflict risk on
  a `git merge upstream/main`. They're called out explicitly below with
  guidance on how to reconcile them.
- **One real migration.** `0086_add_list_position.sql` adds a `position`
  column to `bookmarkLists` (list drag-to-reorder) and backfills it from
  `createdAt` for existing rows. A separate additive `AssetTypes` enum value
  (video thumbnails, `packages/db/schema.ts`) needed no migration at all —
  SQLite/Drizzle don't enforce enums at the DB level, so `drizzle-kit
  generate` reported no schema change for that one. Aside from these two,
  this is overwhelmingly a cosmetic/UI fork plus a few targeted backend
  robustness/performance/feature additions.

## One-time setup (if not already done)

```bash
git remote add upstream https://github.com/karakeep-app/karakeep.git
git fetch upstream
```

## Recommended update workflow

1. `git fetch upstream`
2. `git checkout main && git merge upstream/main`
3. Resolve conflicts using the file-by-file guide below — check the 🔴
   section first, since that's where an actual conflict is most likely.
4. Re-run the full check before pushing:
   ```bash
   pnpm turbo --no-daemon typecheck lint format --continue
   pnpm --filter @karakeep/trpc test
   ```
5. Push → wait for **Build Fork Image** to go green → deploy the new tag on
   the NAS (Container Manager → YAML → bump the image tag → Build).

---

## 🟢 New files (zero merge risk)

| File | Purpose |
|---|---|
| `.github/workflows/fork-build.yml` | Builds and pushes `ghcr.io/<you>/karakeep:latest` + `:<short-sha>` on every push to `main`, using the built-in `GITHUB_TOKEN` (no secrets needed) |
| `apps/web/components/dashboard/bookmarks/BookmarkVideo.tsx` | Click-to-load video player for video attachments (feed thumbnails do zero network activity until clicked) |
| `apps/web/components/dashboard/bookmarks/MasonryMediaCard.tsx` | Eagle/Pinterest-style borderless, media-only masonry tile with hover-dim + white action icons |
| `apps/web/components/dashboard/bookmarks/NewBookmarkDialog.tsx` | The "+" button/dialog that replaced the inline "NEW ITEM" editor card |
| `apps/web/lib/assetLoadGate.ts` | Shared concurrency limiter (separate budgets for images vs. videos) preventing a scroll burst from overwhelming the server's connection pool |
| `apps/web/lib/hooks/useNearViewportLoadSlot.ts` | Hook combining an IntersectionObserver with the load gate above |
| `apps/web/lib/emoji.ts` | `isEmojiIcon()` — used to hide the `??` placeholder glyph when a list has no real emoji icon |
| `tools/seed-snapshot/src/seed-media.ts` | Dev-only helper: seeds placeholder image/video bookmarks into a local instance for visual testing (not used in production) |
| `apps/web/components/dashboard/bookmarks/GatedImage.tsx` | Shared `<Image>` wrapper that only mounts once granted a concurrency slot (extracted out of `MasonryMediaCard`; reused by `BookmarkVideo`'s thumbnail placeholder) |
| `apps/web/lib/bookmark-drag.ts` | HTML5 drag-and-drop MIME constants for moving a bookmark onto a sidebar list |
| `apps/web/lib/hooks/useBookmarkDragStart.ts` | Shared drag-start handler; tags the drag with the source list ID only when dragged out of a manual list (enables true-move semantics) |
| `apps/web/components/dashboard/preview/BookmarkListBadges.tsx` | Clickable badges in the preview modal showing which list(s) a bookmark belongs to |
| `apps/web/lib/list-drag.ts` | HTML5 drag-and-drop MIME constant for reordering sidebar lists (distinct from `bookmark-drag.ts`, which is for dragging bookmarks *onto* a list) |
| `apps/web/components/dashboard/lists/ListSubfolders.tsx` | Eagle-style row of subfolder tiles shown at the top of a parent list's page, above its bookmarks |
| `packages/db/drizzle/0086_add_list_position.sql` | Real migration: adds `bookmarkLists.position` (real, not-null, default 0) + an index, then backfills existing rows from `createdAt` so they keep their creation order instead of all tying at 0 |

## 🟡 Modified upstream files — small, targeted edits (low conflict risk)

| File | What changed |
|---|---|
| `apps/web/app/dashboard/{archive,favourites,lists/[listId],tags/[tagId]}/page.tsx`, `feeds/[feedId]/page.tsx` | Removed `showDivider={true}` prop (content-area divider removed) |
| `apps/web/app/dashboard/layout.tsx` | Removed `<Separator />` between the sidebar's top nav and the Lists section |
| `apps/web/components/dashboard/ErrorFallback.tsx`, `bookmarks/NoBookmarksBanner.tsx` | Removed border; kept a `bg-muted/40` panel for definition |
| `apps/web/components/dashboard/GlobalActions.tsx` | Added `<NewBookmarkDialog />` to the top header's action icons |
| `apps/web/components/dashboard/bookmarks/BookmarkActionBar.tsx` | Added an optional `className` prop (lets the masonry hover overlay force icons white) |
| `apps/web/components/dashboard/bookmarks/BookmarkLayoutAdaptingCard.tsx` | Exported `MultiBookmarkSelector` so `MasonryMediaCard` can reuse it |
| `apps/web/components/dashboard/header/Header.tsx` | Removed bottom divider; 64px→80px tall; search bar/profile icon padding aligned to match the grid's own inset |
| `apps/web/components/dashboard/lists/ListHeader.tsx` | Added `<NewBookmarkDialog />` next to the `⋯` menu; icon hidden unless it's a real emoji |
| `apps/web/components/shared/sidebar/Sidebar.tsx`, `SidebarLayout.tsx` | Removed the sidebar/content divider; `64px`→`80px` height calc (must match Header's new height everywhere it appears); top padding `16px`→`20px` |
| `apps/web/components/ui/button-group.tsx`, `calendar.tsx`, `command.tsx`, `input-group.tsx`, `input.tsx`, `select.tsx`, `switch.tsx`, `tabs.tsx` | Flat-design pass: removed border/shadow, added `bg-muted` where needed for definition |
| `apps/web/components/ui/card.tsx` | Removed border + shadow; background changed `bg-card`→`bg-muted` (bg-card is identical to the page background in light theme, so it was invisible) |
| `packages/shared-react/components/ui/textarea.tsx` | Removed border; `bg-background`→`bg-muted` |
| `apps/web/components/dashboard/preview/BookmarkPreview.tsx` | Added `<BookmarkListBadges bookmarkId={bookmark.id} />` to the title row |
| `apps/web/components/dashboard/lists/EditListModal.tsx` | Added an X button to clear a list's emoji icon (shows a `Smile` placeholder when empty) |
| `packages/trpc/routers/lists.ts` (icon-clear) | `updateList` accepts `icon: null` to clear a list's icon — separate from the `stats` rewrite noted below |
| `packages/db/schema.ts` | Added `LINK_VIDEO_THUMBNAIL = "linkVideoThumbnail"` to the `AssetTypes` enum (TS-level only; no DB CHECK constraint, no migration generated). Also added `bookmarkLists.position` (real migration, see below) |
| `packages/shared/types/lists.ts` | Added `position: z.number()` to `zBookmarkListSchema` |
| `packages/shared-react/hooks/lists.ts` | Added `useReorderBookmarkList()`, mirroring the existing mutation-hook pattern (invalidates `lists.list` on success) |
| `apps/web/app/dashboard/lists/[listId]/page.tsx` | Renders `<ListSubfolders listId={list.id} />` under `<ListHeader>` |
| `packages/shared/types/bookmarks.ts` | Added `"videoThumbnail"` to `zAssetTypesSchema` |
| `packages/open-api/karakeep-openapi-spec.json` | Regenerated (`pnpm --filter @karakeep/open-api generate`) whenever an exposed Zod schema changes (so far: `zAssetTypesSchema`'s `videoThumbnail`, `zBookmarkListSchema`'s `position`) — the pre-commit hook runs `check` and fails the commit if this file is stale, since it's derived from the Zod schemas, not hand-edited |
| `packages/trpc/lib/attachments.ts` | Added `videoThumbnail` to the 4 exhaustive asset-type maps; marked not user-attachable/detachable (system-generated only) |
| `packages/shared-server/src/queues.ts` | Added optional `assetId` to `zAssetPreprocessingRequestSchema`, so a job can target a specific asset instead of only the bookmark's primary asset |
| `apps/web/lib/attachments.tsx` | Added a `videoThumbnail` icon mapping (used only if it's ever shown in a generic asset list) |
| `apps/web/components/dashboard/preview/AttachmentBox.tsx` | Filters `videoThumbnail` assets out of the user-visible attachment list (system-generated, not user-manageable) |
| `apps/web/components/dashboard/bookmarks/TextCard.tsx` (thumbnail lookup) | Looks up the video's `videoThumbnail` asset and passes it to both the masonry and standard render paths |
| `apps/web/components/dashboard/bookmarks/MasonryMediaCard.tsx` (thumbnail prop) | `media.thumbnailAssetId` passed through to `BookmarkVideo` |
| `packages/trpc/routers/admin.ts` | Added `generateVideoThumbnails` mutation: finds every `linkVideo` asset without a sibling `linkVideoThumbnail` and enqueues a job for it. Backfill for videos that predate this feature. |
| `apps/web/components/admin/BackgroundJobs.tsx` | Added a "Generate missing video thumbnails" button to the existing Asset Preprocessing job card (Settings → Admin → Background Jobs), calling the mutation above |
| `apps/workers/workers/videoWorker.ts` | After an auto-downloaded video (yt-dlp, e.g. embedded YouTube/X/Reddit videos) is saved, now also enqueues a thumbnail job — this path writes the asset straight to the DB and previously bypassed thumbnail generation entirely, unlike the manual-attach path |
| `packages/trpc/testUtils.ts` | Added `AssetPreprocessingQueue` to the shared queue mock used by `defaultBeforeEach` — it was missing, so any trpc test that reached a real `.enqueue()` call for it would fail against the in-memory test DB (no `tasks` table); surfaced while adding a real test for `generateVideoThumbnails` |
| `packages/trpc/routers/admin.test.ts` | Switched from a bespoke `buildTestContext` beforeEach to the shared `defaultBeforeEach` (picks up the queue mocks above); added tests for `generateVideoThumbnails` |

## 🔴 Substantially reworked files — highest conflict risk, check these first

| File | What changed & why | Merge guidance |
|---|---|---|
| `tooling/tailwind/globals.css` | **Entire color palette replaced.** Dark theme is now a neutral charcoal + purple accent; light theme is a Pinterest-style white + red accent. Every CSS variable under `:root` and `.dark` was rewritten. | If upstream adds/renames a variable, take upstream's *variable name*, but keep **our** color *value*. If upstream only tweaks values we didn't touch, this should merge cleanly. |
| `apps/web/components/dashboard/bookmarks/TextCard.tsx` | Added a masonry-layout branch: renders `MasonryMediaCard` for video-attached text bookmarks instead of the standard card body. | If upstream changes the surrounding card logic, keep our added `layout === "masonry"` branch and reapply it around upstream's new code. |
| `apps/web/components/dashboard/bookmarks/AssetCard.tsx` | Same masonry-layout branch, for image assets. | Same approach as TextCard.tsx above. |
| `apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx` | Removed the inline `EditorCard` from the grid entirely (replaced by the "+" dialog); masonry-layout cards get no border/`bg-card`; widened the `Masonry` gap 16px→20px; widened the infinite-scroll `rootMargin` so pagination fires ~1200px early. | Diff carefully — this file has four independent changes bundled in. Reapply each piece individually against upstream's version rather than doing a blind merge. |
| `apps/web/components/dashboard/bookmarks/EditorCard.tsx` | Added `inDialog`/`onCreated` props so the same component can render inside `NewBookmarkDialog` without its own card chrome (title row, fixed height). | Should merge cleanly unless upstream changes the same prop surface; if so, keep our two new optional props. |
| `apps/web/components/dashboard/lists/AllListsView.tsx` | Removed the colored accent bar and the emoji's card/border/shadow from list rows; chevron space is now only reserved for rows that actually have subfolders (was previously reserved for every row). | Re-verify the `collapsible` conditional still gates the chevron `<div>` correctly after merging. |
| `apps/web/components/dashboard/sidebar/AllLists.tsx` | Same chevron-reservation fix, for the sidebar tree; removed the default 📋/⭐ emoji icons on "All Lists"/"Favourites"; added `useDropTarget` (drag-and-drop true-move: `addToList` then `removeFromList` from the source list, using existing tRPC mutations — no backend change); passes `reorderable` to the owned-lists `CollapsibleBookmarkLists` (shared lists aren't reorderable — see below). | Same as above; also re-verify `useDropTarget`'s drop handler after merging. |
| `apps/web/components/dashboard/lists/CollapsibleBookmarkLists.tsx` | Removed the two `.sort((a,b) => a.item.name.localeCompare(...))` alphabetical sorts, replaced with sorting by the new `position` field (descending — newest/most-recently-moved-up sorts first). Added `ReorderableSiblings`, a wrapper that adds HTML5 drag-and-drop reordering (with an insertion-line indicator) around a group of same-parent siblings, gated by a new `reorderable` prop (only the owned-lists tree passes `true` — reordering a shared list's row would silently reorder it for the owner too, since `position` lives on the same DB row regardless of who's viewing). | If upstream changes the sort or the recursion here, keep the `position`-based sort and re-wrap the sibling `.map()` calls (root-level and `ListItem`'s children) in `ReorderableSiblings`. |
| `packages/trpc/models/lists.ts` | Added `List.getNextPosition()` (new lists get `max(siblings) + 1`, so newest sorts first) and `List.reorder()` (moves a list to a new index among its siblings; interpolates a new `position` between its new neighbors — or beyond the top/bottom edge — so only the moved row is touched, no renumbering). `create()` now calls `getNextPosition()`. | Additive — two new methods plus one line in `create()`. Should merge cleanly unless upstream restructures `create()`, in which case keep the `position` assignment. |
| `packages/trpc/routers/lists.ts` | **Backend logic change, not cosmetic — two of them.** (1) Rewrote the `stats` procedure to batch all manual-list bookmark counts into a single grouped SQL query instead of issuing one query per list (the original perf fix). (2) `stats` now also rolls a parent (sub)folder's count up from everything nested under it (recursively, via each list's `parentId`), instead of showing only bookmarks added to the parent directly — most "parent" lists are pure organizational folders with 0 bookmarks of their own. (3) Added the `reorder` mutation (owner-only, see `List.reorder()` above). | **This is the one file where a careless merge could silently reintroduce a real performance bug or drop the rollup.** If upstream also touches `stats`, read both versions fully — don't take "theirs" by default. Smart lists still call `getSize()` individually; only manual-list counts are batched, and the rollup pass runs after. |
| `packages/trpc/models/assets.ts` | `attachAsset()` now enqueues an `AssetPreprocessingQueue` job (with `assetId` set) whenever a `video` asset is attached, to generate a poster-frame thumbnail. `detachAsset()` now also deletes the orphaned `linkVideoThumbnail` companion asset when its `linkVideo` is detached. | If upstream changes `attachAsset`/`detachAsset`, keep both new blocks (the `if (input.asset.assetType === "video")` enqueue, and the thumbnail-cleanup block in `detachAsset`) and reapply around upstream's version. |
| `apps/workers/workers/assetPreprocessingWorker.ts` | Added `extractAndSaveVideoThumbnail()` (ffmpeg `-frames:v 1 -update 1` frame grab, scaled to preserve aspect ratio, capped at 1280px wide), mirroring the existing PDF-screenshot pattern. `run()` branches early on `req.data.assetId` to target this specific-asset job type before falling through to the existing primary-asset logic (unchanged). | Additive — a new function plus one early branch at the top of `run()`. Should merge cleanly unless upstream restructures `run()`'s dispatch, in which case keep the `req.data.assetId` branch and the new function. |
| `apps/web/components/dashboard/bookmarks/BookmarkVideo.tsx` | Added `thumbnailAssetId` prop: renders the real poster-frame image (via `GatedImage`) behind the play-icon overlay instead of a flat black box; falls back to black if no thumbnail exists yet (older attachments, or extraction failed). | Should merge cleanly — additive prop + conditional render. |

## Non-git-visible change — redo this manually if you ever start a fresh fork

Two of karakeep's own workflows were disabled via the GitHub Actions UI, not
by editing the workflow files — so this won't show up in git history or
survive re-forking from scratch:

- **`CI`** — the full lint/test/typecheck suite. Disabled because Claude runs
  the same checks locally before every push; redundant on a solo fork.
- **`Build and Push Docker`** — upstream's own image-publish workflow. It can
  never succeed on a fork (wrong registry ownership) and just adds noise.

To redo: **Actions → select the workflow (left sidebar) → `⋯` → Disable
workflow.**

## What to test after any upstream merge

- [ ] `pnpm turbo --no-daemon typecheck lint format --continue` — must all pass
- [ ] `pnpm --filter @karakeep/trpc test` — especially `lists.test.ts` (covers the `stats` rewrite)
- [ ] Visually: masonry feed (image + video tiles, hover-dim, white icons), dark/light theme, header/sidebar alignment, the "+" new-bookmark dialog
- [ ] Scroll through a large image- or video-heavy list — confirm no tiles get stuck blank
- [ ] Attach a video and confirm a real poster-frame thumbnail appears in the feed (not a black box) once the worker finishes; check `ffmpeg` is present in the worker's container/environment
- [ ] Settings → Admin → Background Jobs → Asset Preprocessing → "Generate missing video thumbnails" — confirm it enqueues only videos actually missing a thumbnail (not already-thumbnailed ones)
- [ ] Drag a sidebar list to reorder it — confirm the insertion line tracks the cursor and the new order persists after a refresh
- [ ] Open a list with subfolders — confirm its combined count (header + sidebar) equals the sum of its subfolders' counts, and the subfolder tiles at the top of the page link to the right lists
- [ ] Deploy to the NAS and re-test against the real, large dataset before calling it done — several of these bugs only reproduced at real scale (thousands of bookmarks, 100+ lists), not against small local test data
