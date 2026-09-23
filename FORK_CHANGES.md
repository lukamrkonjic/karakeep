# Fork Changes & Merge Guide

This file catalogues every change this fork has made on top of upstream
[karakeep-app/karakeep](https://github.com/karakeep-app/karakeep), so that
pulling in upstream updates is easy to reason about and merge conflicts are
quick to resolve.

## TL;DR — how updatable is this fork?

**Very.** Of the ~42 changed files:

- **8 are brand-new files**, plus the whole of `desktop/`. Upstream will
  never touch these, so they can never conflict.
- **~20 are small, targeted edits** (a handful of lines each — removing a
  border class, dropping a prop, adding one line). If upstream changes a
  *different* part of the same file, git merges these automatically; if it
  touches the exact same line, the conflict is a one-glance fix.
- **~8 files were substantially reworked** and are the real conflict risk on
  a `git merge upstream/main`. They're called out explicitly below with
  guidance on how to reconcile them.
- **Three migrations.** `0094_add_list_position.sql` adds a `position`
  column to `bookmarkLists` (list drag-to-reorder) and backfills it from
  `createdAt` for existing rows; `0095` is data-only (mangled list icons);
  `0096_list_subscriptions.sql` adds the two list-subscription tables and a
  user setting (Pinterest board sync — see below). A separate additive
  `AssetTypes` enum value (video thumbnails, `packages/db/schema.ts`) needed
  no migration at all — SQLite/Drizzle don't enforce enums at the DB level,
  so `drizzle-kit generate` reported no schema change for that one. Aside
  from these, this is overwhelmingly a cosmetic/UI fork plus a few targeted
  backend robustness/performance/feature additions.

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
   If the merge touched `packages/db/drizzle/`, also confirm the snapshot
   chain is intact — this must print *"No schema changes, nothing to
   migrate"*:
   ```bash
   pnpm --filter @karakeep/db exec drizzle-kit generate
   ```
5. Push → wait for **Build Fork Image** to go green → the NAS follows
   `:latest` and a DSM scheduled task downloads it within ten minutes, so
   `sudo docker compose up -d` in `/volume1/docker/karakeep` switches to it.
   `.claude/skills/update-karakeep/SKILL.md` has the one-time setup,
   rollback (pin a commit tag) and the fixes for errors seen so far.

### Note for checkouts on Windows

Git here runs with `core.autocrlf=true`, so every file lands in the working
tree with CRLF endings while `oxfmt` and the OpenAPI generator both emit LF.
That makes two of the checks above fail on *every* package — including ones
the merge never touched — for reasons that have nothing to do with the code:

- `format` (`oxfmt --check`) reports issues repo-wide.
- `pnpm run --filter @karakeep/open-api check` exits 1 with no message.

Neither is a real failure, and neither should be "fixed" by reformatting the
repo. To check them meaningfully, run the formatter/generator in write mode
and then look at `git diff` — git normalises line endings through the index,
so an empty diff means the content was already correct:

```bash
npx oxfmt <the files you changed> && git diff --stat -- <those files>
```

The same applies to the husky pre-commit hook, which runs the OpenAPI check;
`git commit --no-verify` is the pragmatic way through it on this machine.

---

## 🟢 New files (zero merge risk)

| File | Purpose |
|---|---|
| `desktop/` (whole directory) | **Magpie**, an Electron collector browser, plus the Karakeep Drop tray app it grew out of. Lives outside the pnpm workspace with its own `package.json` and lockfile — see `desktop/README.md` for why — so upstream never touches it and the server's Docker build never installs it. Talks to the server only through the public REST API, so it needs no backend change. |
| `.github/workflows/fork-build.yml` | Builds and pushes `ghcr.io/<you>/karakeep:latest` + `:<short-sha>` on every push to `main`, using the built-in `GITHUB_TOKEN` (no secrets needed). `SERVER_VERSION` is `fork-<short-sha>`, so Settings → Admin shows which build runs |
| `.claude/skills/update-karakeep/SKILL.md` | The NAS update guide, as a Claude Code skill (`/update-karakeep`): the NAS follows `:latest`, a DSM scheduled task pulls it every 10 minutes, and `docker compose up -d` switches to it; plus the one-time setup, stop/start, rollback by pinning a commit tag, and the errors seen so far (wrong folder, `compose.yaml` not `docker-compose.yml`, the dead `gcr.io` Chrome image). Upstream's own `skills/SKILL.md` is a different thing — how to use the Karakeep CLI |
| `apps/web/components/dashboard/bookmarks/BookmarkVideo.tsx` | Video attachments. In the feed a video never plays: the tile is its poster (zero network activity), a play mark shows on hover, and a click opens the preview modal. In the modal it autoplays — only the copy actually on screen, since the preview renders its wide and narrow layouts side by side and a CSS-hidden `<video autoplay>` still plays (doubled audio) |
| `apps/web/components/dashboard/bookmarks/MasonryMediaCard.tsx` | Eagle/Pinterest-style borderless, media-only masonry tile with hover-dim + white action icons |
| `apps/web/components/dashboard/bookmarks/NewBookmarkDialog.tsx` | The "+" button/dialog that replaced the inline "NEW ITEM" editor card |
| `apps/web/lib/assetLoadGate.ts` | Shared concurrency limiter (separate budgets for images vs. videos) preventing a scroll burst from overwhelming the server's connection pool |
| `apps/web/lib/hooks/useNearViewportLoadSlot.ts` | Hook combining an IntersectionObserver with the load gate above |
| `apps/web/lib/emoji.ts` | `isEmojiIcon()` — used to hide the `??` placeholder glyph when a list has no real emoji icon |
| `tools/seed-snapshot/src/seed-media.ts` | Dev-only helper: seeds placeholder image/video bookmarks into a local instance for visual testing (not used in production) |
| `apps/web/components/dashboard/bookmarks/GatedImage.tsx` | Shared `<Image>` wrapper that only mounts once granted a concurrency slot (extracted out of `MasonryMediaCard`; reused by `BookmarkVideo`'s thumbnail placeholder) |
| `apps/web/lib/bookmark-drag.ts` | HTML5 drag-and-drop MIME constants for moving a bookmark onto a sidebar list |
| `apps/web/lib/hooks/useBookmarkDragStart.ts` | Shared drag-start handler; tags the drag with the source list ID only when dragged out of a manual list, and always allows `move` (every drop onto a list is a move — see `AllLists.tsx`) |
| `apps/web/components/dashboard/preview/BookmarkListChips.tsx` | The preview's "List" section (replaced the old title-row list badges): a chip per list the bookmark is in (hover shows an × that removes it from that list), a + that adds it to another list, "Unsorted" when it's in none. This is the one place a bookmark goes into several lists — dragging onto a sidebar list moves it |
| `apps/web/components/dashboard/preview/MediaFitPreview.tsx` | Preview-modal layout for image/video bookmarks (and notes carrying a video): the dialog wraps the media at its own size, capped to the viewport, instead of a fixed 90% box; the details sit in a panel beside it exactly as tall as the media that scrolls on its own (absolutely positioned inside its column so it never adds height). `getPreviewMedia()` decides what counts as media |
| `apps/web/lib/list-drag.ts` | HTML5 drag-and-drop MIME constant for reordering sidebar lists (distinct from `bookmark-drag.ts`, which is for dragging bookmarks *onto* a list) |
| `apps/web/components/dashboard/lists/ListSubfolders.tsx` | Eagle-style row of subfolder tiles shown at the top of a parent list's page, above its bookmarks |
| `packages/db/drizzle/0094_add_list_position.sql` | Real migration: adds `bookmarkLists.position` (real, not-null, default 0) + an index, then backfills existing rows from `createdAt` so they keep their creation order instead of all tying at 0. **Was `0086_` until the first upstream merge, which brought its own `0086`–`0093`.** When renumbering a fork migration that is already deployed, keep its original `when` in `meta/_journal.json` (here `1782916466061`) and rebuild its snapshot on top of the new predecessor: drizzle applies any migration whose journal `when` exceeds the newest `created_at` in `__drizzle_migrations`, so an unchanged timestamp is what stops a live database re-running an `ALTER TABLE` that would fail. Confirm with `drizzle-kit generate` — it must report *no schema changes*. |
| `apps/web/lib/sidebarCollapse.ts` | Zustand store (with `persist` middleware) for whether the desktop sidebar is folded in — `{ collapsed, toggle }` |
| `apps/web/components/shared/sidebar/SidebarCollapseWrapper.tsx` | Wraps the sidebar `<aside>`; collapses its width to 0 (overflow-hidden, animated) instead of unmounting it, so its scroll position/state survives a fold in/out |
| `apps/web/components/shared/sidebar/SidebarCollapseToggle.tsx` | Small chevron beside the header logo that folds the sidebar in/out (replaced `KarakeepLogoToggle`, which made the logo itself the toggle — the logo is a link home again). Renders the server default until mounted, so the stored state can't hydrate a different arrow |
| `apps/web/lib/tailoredFeed.ts` | Which lists the tailored feed draws from, in localStorage. Stored as EXCLUSIONS, so a list made later is in the feed until you take it out |
| `apps/web/components/dashboard/feed/TailoredFeedSettings.tsx` | The feed's list picker ("…" → "Choose lists…", in the sidebar and on the page; controlled `open`/`setOpen`, trigger optional): the sidebar's own tree with a tick per list, reusing `CollapsibleBookmarkLists`. A folder ticks/unticks everything under it and shows half-ticked when only some of it is in; `feedCandidates()` is the shared "your own manual lists" rule |
| `apps/web/components/dashboard/feed/TailoredFeed.tsx`, `apps/web/app/dashboard/feed/page.tsx` | The page at /dashboard/feed: "N of M lists", its "…" menu (`TailoredFeedOptions`: Choose lists…, Sort), and one grid of everything in the chosen lists (`listIds`) |
| `apps/web/components/dashboard/bookmarks/ClientBookmarksGrid.tsx` | `UpdatableBookmarksGrid` for pages whose query only exists in the browser (the feed's list choice, the tag filter): fetches the first page client-side instead of on the server, and is keyed on the query so a new choice starts a fresh grid |
| `apps/web/components/dashboard/tags/TagFilterView.tsx`, `TagsHome.tsx` | The tags page: find things by tag first (type to narrow the cloud, click tags, everything carrying ALL of them shows below, selection in `?with=`), with upstream's `AllTagsView` management one click away |
| `apps/web/lib/sublists.ts`, `apps/web/components/utils/useShowSublists.ts` | The "…" menu's "Show items from sub-lists" setting. A cookie, not localStorage, so the server-rendered list page builds the right query straight away instead of flashing the parent's own items first |
| `apps/web/components/dashboard/lists/NewListButton.tsx` | The All Lists page's "New list" button, as a client component. Radix's `asChild` trigger clones its child to put the trigger's props on it, and a child handed down from a SERVER component is still an unresolved reference while the server renders — so the trigger cloned nothing, the button was missing from the server's HTML, and appeared only on hydration (that page's long-standing hydration mismatch). Any `asChild` trigger whose child comes from a server component has the same bug |
| `packages/db/drizzle/0095_clear_mangled_list_icons.sql` | Data migration: clears list icons that are only "?"/U+FFFD/blanks. 94 of Luka's 103 lists stored `??` — an emoji that crossed a non-Unicode code page, one "?" per UTF-16 half — and every client printed it in front of the list name (web, browser extension, API). Pairs with `normalizeListIcon()`, which stops new ones being written |
| `apps/workers/workers/subscriptionWorker.ts` | **List subscriptions** — keeps a manual list in sync with a public Pinterest board. An hourly cron queues what is due (per-user interval, 10 min slack so "every 3 h" doesn't drift to 4), the runner reads the whole board and files what is new: oldest first, each bookmark stamped with its own second (`createdAt` is second-precision and ties sort by random id), so the list shows the board's order. The `listSubscriptionImports` ledger means nothing downloads twice: a pin the subscription handled is never touched again (even after its bookmark was moved or deleted), and a picture the user already has — the same image pinned twice, or a board removed and added again — is linked into the list instead of copied. Downloads stream to disk under `MAX_ASSET_SIZE_MB`; a picture/video that can never be had is remembered as skipped, a passing failure retried next sync; five failures in a row, the quota, or losing the list stop the run with a message. Boards over 300 new pins continue in back-to-back runs. Worker name `subscription` (for `WORKERS_ENABLED_WORKERS`/`WORKERS_DISABLED_WORKERS`) |
| `apps/workers/workers/connectors/pinterest.ts` | Reads a public board: the page's `__PWS_INITIAL_PROPS__` for page 1, then `BoardFeedResource/get` with the page's cookies + app version + CSRF token **and `x-pinterest-pws-handler`** (without it: 403 "Invalid Resource Request"), `filter_section_pins: false` like the page itself. Takes only each pin's own media from `*.pinimg.com` — the `.mp4` of a video (its `video_list` puts two HLS playlists of the same width first, which can't be stored), else `images.orig` — so avatars, favicons and "more ideas" never come in; skips `story` modules. `image_signature` is the media key. If Pinterest changes its front-end, this file is the one to fix |
| `packages/trpc/routers/listSubscriptions.ts` | `list`/`listAll`/`create`/`update`/`delete`/`runNow`. Needs edit rights on the list; `create` normalises any Pinterest domain to `www.pinterest.com` and syncs straight away; resuming a paused one syncs too. Deleting keeps the pictures and the ledger |
| `packages/shared/types/listSubscriptions.ts`, `packages/shared/utils/pinterest.ts` | Zod schemas + interval choices; `parsePinterestBoardUrl()` (board links only — not pins, profiles or their `_saved`/`_created` tabs, sections, or hosts that merely contain "pinterest") |
| `packages/db/drizzle/0096_list_subscriptions.sql` | Real migration: `listSubscriptions`, `listSubscriptionImports` (the ledger: per user, `subscriptionId` set null on delete, indexed on `bookmarkId` so deleting a bookmark doesn't scan it) and `user.subscriptionIntervalHours` (default 12) |
| `apps/web/components/dashboard/lists/ListSubscriptionsModal.tsx`, `ListSubscriptionStatus.tsx` | The list "…" → "Add subscription" modal (add a board link, pause/resume, remove, "Sync now") and the shared status line ("Syncing…" polls every 2 s; when a sync finishes the grid and counts refresh) |
| `apps/web/components/settings/ListSubscriptionSettings.tsx`, `apps/web/app/settings/list-subscriptions/page.tsx` | Settings → List subscriptions: the schedule (only when asked / 3 h / 6 h / 12 h / daily / weekly) and every subscription with its list |
| `packages/trpc/models/bookmarkOrders.ts` | getBookmarks' fork orders: **random** (each item ranked by a hash of its id and `shuffleSeed`, so a new seed per page load reshuffles everything while one scroll stays put) and **addedToList** (when a bookmark joined the list; the latest across lists for sub-lists/the feed; falls back to the saved date). Reads the matching ids + keys in one query, orders them, pages by the last item's key (not an offset, so a drag-and-drop move mid-scroll neither repeats nor skips) and loads the page through `loadMulti` by id. The key rides in the usual cursor's `id` as JSON, so no client or REST type changes |
| `apps/web/lib/pageSort.ts`, `apps/web/lib/hooks/usePageSort.ts` | Each page's Sort choice in one cookie (`karakeep-sort`, `key=sort\|…`, only non-defaults, capped at 100) so server pages load sorted; the hook reads it via `useSyncExternalStore` (no hydration mismatch) and a change refreshes the page |
| `apps/web/components/dashboard/sort/SortSubmenu.tsx`, `sort/PageSortButton.tsx`, `PageOptions.tsx`, `feed/TailoredFeedOptions.tsx` | The "Sort: …" submenu (bookmarks: Newest / Oldest / Recently added / Random; All Lists: Your order / Name / Most items / Random), the home feed's header sort button, and the "…" menu for pages that aren't lists (sidebar variant on hover, header variant) |
| `apps/web/lib/previewDetails.ts` | Whether a preview shows its details panel — one persisted setting for every preview |
| `apps/web/components/dashboard/preview/ZoomableImage.tsx` | The preview's picture: wheel/pinch zooms at the pointer (up to 8×), drag pans (clamped so the picture covers its box), − / + / reset bottom right, a click at normal size opens the original. Native non-passive wheel listener; buttons are excluded from pointer capture |
| `apps/workers/imageFormats.ts` | AVIF and other formats. `imageForAnalysis()` hands OCR and AI tagging a PNG copy of anything they can't read (AVIF — Tesseract and the vision APIs don't take it); `convertForStorage()` turns a format no browser shows (TIFF) into a PNG before the subscription worker stores it. Uses `sharp` (now a workers dependency, same version the web app already ships). HEIC, JPEG XL and BMP can't be decoded by the bundled libvips, so they stay unsupported |

## 🟡 Modified upstream files — small, targeted edits (low conflict risk)

| File | What changed |
|---|---|
| `apps/web/app/dashboard/{archive,favourites,lists/[listId],tags/[tagId]}/page.tsx`, `feeds/[feedId]/page.tsx` | Removed `showDivider={true}` prop (content-area divider removed) |
| `apps/web/app/dashboard/layout.tsx` | The desktop sidebar has no top nav any more: the lists lead, and Archive is a footer item pinned below them (`footerItems`). Home is the header logo, search the header bar, Tags and Highlights moved to the profile menu. The mobile menu keeps every destination (it has no header logo to go home by) |
| `apps/web/components/dashboard/ErrorFallback.tsx`, `bookmarks/NoBookmarksBanner.tsx` | Removed border; kept a `bg-muted/40` panel for definition |
| `apps/web/components/dashboard/GlobalActions.tsx` | Added `<NewBookmarkDialog />` to the top header's action icons |
| `apps/web/components/dashboard/bookmarks/BookmarkActionBar.tsx` | Added an optional `className` prop (lets the masonry hover overlay force icons white) and `showExpand` (media tiles pass `false`: clicking the tile already opens the preview, so the expand icon was redundant there; link/note cards keep it) |
| `apps/web/components/dashboard/bookmarks/BookmarkLayoutAdaptingCard.tsx` | Exported the bulk-selection overlay so `MasonryMediaCard` can reuse it. Upstream has since renamed it `MultiBookmarkSelector` → `BulkEditSelectionOverlay`; the fork took upstream's name and kept only the `export` |
| `apps/web/components/dashboard/header/Header.tsx` | Removed bottom divider; 64px→80px tall; search bar/profile icon padding aligned to match the grid's own inset; the logo is a `<Link>` home, with `<SidebarCollapseToggle>` beside it (see above) |
| `apps/web/components/dashboard/lists/ListHeader.tsx` | Added `<NewBookmarkDialog />` next to the `⋯` menu; icon hidden unless it's a real emoji |
| `apps/web/components/shared/sidebar/Sidebar.tsx`, `SidebarLayout.tsx` | Removed the sidebar/content divider; `64px`→`80px` height calc (must match Header's new height everywhere it appears); top padding `16px`→`20px`; kept upstream's `xl:w-72`. Note the expanded width is duplicated in three places that must stay in sync — `Sidebar.tsx`, `SidebarCollapseWrapper.tsx` (which clips the aside, so a wider aside needs a wider wrapper) and `Header.tsx`'s logo block (`xl:w-[17rem]`). `SidebarLayout.tsx` also swapped its plain `<div>{sidebar}</div>` for `<SidebarCollapseWrapper>{sidebar}</SidebarCollapseWrapper>` (see 🟢 above) |
| `apps/web/components/ui/calendar.tsx`, `command.tsx`, `input.tsx`, `select.tsx`, `switch.tsx`, `tabs.tsx` | Flat-design pass: removed border/shadow, added `bg-muted` where needed for definition. (`button-group.tsx` and `input-group.tsx` also got this pass but upstream has since deleted both — nothing imported them — and the fork accepted the deletion.) |
| `apps/web/components/ui/card.tsx` | Removed border + shadow; background changed `bg-card`→`bg-muted` (bg-card is identical to the page background in light theme, so it was invisible) |
| `packages/shared-react/components/ui/textarea.tsx` | Removed border; `bg-background`→`bg-muted` |
| `apps/web/components/dashboard/preview/BookmarkPreview.tsx` | New `variant` prop: `"modal"` wraps a picture/video with `MediaFitPreview` and gives everything else an explicit 90vw×90vh box; `"page"` (default) fills its parent as before. `<BookmarkListChips>` is a section above Tags (the title-row badges are gone), and a video note's text shows in the details panel. The original wide layout's JSX is re-indented inside the `media ?` ternary, so a conflict there is usually indentation only |
| `apps/web/app/dashboard/@modal/(.)preview/[bookmarkId]/page.tsx` | `DialogContent` is sized by its content (`w-auto max-w-[95vw]`, no fixed height) and passes `variant="modal"` |
| `apps/web/components/dashboard/header/ProfileOptions.tsx` | Tags and Highlights entries at the top of the profile menu (moved out of the sidebar) |
| `apps/web/components/dashboard/preview/AssetContentSection.tsx`, `TextContentSection.tsx` | Their `<BookmarkVideo>` autoplays and gets the extracted poster frame |
| `apps/web/components/dashboard/bookmarks/AssetCard.tsx`, `TextCard.tsx`, `MasonryMediaCard.tsx` (video tiles) | Pass `bookmarkId` to `<BookmarkVideo thumbnail>` so the tile links to the preview |
| `packages/shared/types/bookmarks.ts` (getBookmarks input) | Added `listIds` (bookmarks in ANY of them) and `tagIds` (bookmarks carrying ALL of them). Internal only — this schema isn't part of the OpenAPI spec, so the REST surface is unchanged |
| `packages/trpc/models/bookmarks.ts` (loadMulti) | Both filters as subquery conditions on the plain-bookmarks path (which already restricts to your own bookmarks). Empty `listIds` returns nothing rather than everything, and neither combines with `listId`/`tagId`/`rssFeedId` — those drive their own query strategies. Covered by a test in `bookmarks.test.ts` |
| `packages/shared/utils/listUtils.ts` | `normalizeListIcon()` (the icon rule: an emoji or nothing) and `listNameFromPath()` no longer prints a leading space for a list with no icon |
| `packages/trpc/models/lists.ts` | Normalises the icon on create and update, so a mangled one can never be stored again (an edit that doesn't touch the icon still leaves it alone) |
| `apps/web/components/dashboard/lists/EditListModal.tsx` (icon default) | A new list starts with NO emoji (was `📁`, which is why lists seemed to need one); picking one still works |
| `apps/web/components/dashboard/sidebar/AllLists.tsx` (entries) | "Tailored feed" and "Tags" sit under "All Lists"; All Lists, Tailored feed, Tags and Favourites each have a "…" on hover (`PageOptions`), and every row's "…" — lists' too — is right-aligned in the count's slot so they line up. Its `useDropTarget` now leaves the whole source folder: a bookmark dragged off a parent that is showing its sub-lists' items leaves the sub-list it actually sits in |
| `apps/web/components/dashboard/header/ProfileOptions.tsx` | Tags went back to the sidebar; Highlights stays in the menu |
| `apps/web/app/dashboard/lists/page.tsx` | Renders `<NewListButton />` instead of building the `EditListModal` trigger inline (see above) |
| `apps/web/app/dashboard/lists/[listId]/page.tsx` | Reads the sub-lists cookie and asks for the list plus everything nested under it (`listIds`) when it's on |
| `apps/web/components/dashboard/lists/ListOptions.tsx` | "Show items from sub-lists", beside "Show Archived", on manual lists that have children |
| `apps/web/components/ui/dialog.tsx`, `app/dashboard/@modal/(.)preview/[bookmarkId]/page.tsx` | `DialogContent` takes an `overlayClassName`; the media preview dims the page to `bg-black/95` (other dialogs keep `/80`) |
| `app/dashboard/{archive,favourites,lists}/page.tsx`, `components/dashboard/lists/AllListsView.tsx` | Dropped the hard-coded 🗄️/⭐️/📋 from the page headers and the Favourites/Archive rows (`icon` is optional now). Lists you make keep whatever emoji you give them |
| `apps/web/components/dashboard/bookmarks/ManageListsModal.tsx`, `lists/DeleteListConfirmationDialog.tsx` | Build list labels through `listNameFromPath()` / skip the empty icon, instead of always `icon + " " + name` |
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
| `packages/trpc/routers/admin.ts` | Added `generateVideoThumbnails` mutation: finds every video asset without a sibling `linkVideoThumbnail` and enqueues a job for it. Matches `assetType === "linkVideo"` OR (`assetType === "bookmarkAsset"` AND `contentType` is a video type) — `linkVideo` alone is trusted since it's an explicit label set at attach time, independent of `contentType` (which can be missing/wrong for assets bulk-imported straight into the DB, bypassing the sniffing upload endpoint — an initial `contentType`-only version of this query silently missed those). Takes a `regenerate` flag: when true it first deletes every existing `linkVideoThumbnail` (row + file) so the worker's "already generated" guard doesn't short-circuit, then re-enqueues all videos — used to repair the all-black thumbnails the old first-frame extraction produced. Also added the `cancelQueuedJobs` mutation (calls the given queue's `cancelAllNonRunning()` from liteque — aborts an accidental bulk enqueue like a runaway "reprocess assets"). And widened `getBookmarkDebugInfo`'s output schema's `assetInfo.assetType` to include `"video"` (an `.output()` schema trpc validates at runtime, so it throws if not kept in sync) |
| `packages/trpc/routers/bookmarks.ts` | `createBookmark`'s `ASSET` case now enqueues the video-thumbnail job (with `assetId` set) instead of the default image/pdf preprocessing job when `assetType === "video"` — the default path only knows "image"/"pdf" and was throwing `"Unsupported bookmark type"` for every directly-uploaded video, silently failing the job (see the ASSET-bookmark video fix below) |
| `packages/db/schema.ts` (bookmarkAssets) | Widened `bookmarkAssets.assetType` from `["image", "pdf"]` to `["image", "pdf", "video"]` so a directly-uploaded/drag-dropped video file can become a bookmark's own content (previously only possible via a `link` bookmark's attached video). TS-level enum only, no migration (same as the `AssetTypes` note above) |
| `packages/shared/types/bookmarks.ts` (asset bookmark) | Same `"video"` addition to the 3 `assetType: z.enum(["image","pdf"])` occurrences (`zBookmarkedAssetSchema`, `zNewBookmarkRequestSchema`, `zPublicBookmarkSchema`) |
| `packages/shared/assetdb.ts` | Added `...VIDEO_ASSET_TYPES` to `SUPPORTED_BOOKMARK_ASSET_TYPES` — this was the actual bug: video files uploaded fine (already in `SUPPORTED_UPLOAD_ASSET_TYPES`) but were rejected with "Unsupported asset type" the moment you tried to turn that upload into a bookmark |
| `apps/web/components/dashboard/UploadDropzone.tsx` | Fixed a real client bug: it hardcoded `assetType: contentType === "application/pdf" ? "pdf" : "image"` — any non-PDF file, including videos, got mislabeled `"image"`. Now checks for `video/*` too. Updated the drop placeholder text. **Also (paste-to-save):** `useUploadAsset` now reads `useBookmarkListContext()` and adds the created bookmark to the current manual list — so drag-drop, editor paste, and the new global paste all land in the list you're viewing (was previously created loose, never added to the list). And the component registers a `document`-level `paste` listener: a clipboard image (a macOS `⌘⌃⇧4` / Windows `Win+Shift+S` screenshot snippet) pasted anywhere on a bookmarks/list page uploads as a bookmark, skipping pastes that land in a text field / the note editor (`isEditableTarget` guard) and demo mode. Restructured `useUploadAsset` to sequence upload → create → add-to-list (create was previously fired inside `useUpload`'s `onSuccess`, so the new bookmark id wasn't available to add to a list). |
| `apps/web/components/dashboard/bookmarks/AssetCard.tsx` | Added a `"video"` case (renders `<BookmarkVideo>`) to `AssetImage`'s switch — it has an exhaustive `never` check, so this was a real compile error once the enum widened, not just a missing feature. Also extended the masonry-layout branch to cover video the same way `TextCard.tsx` does for link bookmarks. |
| `apps/web/components/dashboard/preview/AssetContentSection.tsx` | Added a `VideoContentSection` (mirrors `TextContentSection`'s `<BookmarkVideo>` usage) so the full preview modal plays a directly-uploaded video instead of showing "Unsupported asset type" |
| `packages/trpc/models/bookmarks.ts` (getBannerImageUrl) | Added a `"video"` case (returns `null` — no poster-frame generation for this path) to another exhaustive `never`-checked switch that broke once the enum widened |
| `packages/sdk/src/karakeep-api.d.ts` | Hand-patched the 2 `assetType: "image" \| "pdf"` occurrences to include `"video"`, instead of a full `openapi-typescript` regenerate — the installed codegen version (7.8.0) reformats the entire ~6800-line file well beyond this change, so a full regenerate would bury the real diff in unrelated noise. Only re-run the generator wholesale if you're already touching this file for another reason. |
| `apps/web/components/admin/BackgroundJobs.tsx` | Added "Generate missing video thumbnails" + "Regenerate all video thumbnails" buttons to the Asset Preprocessing job card (Settings → Admin → Background Jobs), and a "Cancel queued jobs" button to every queue card that supports it (crawler, inference, indexing, embeddings, asset preprocessing, video), each calling the mutations above |
| `apps/workers/workers/videoWorker.ts` | After an auto-downloaded video (yt-dlp, e.g. embedded YouTube/X/Reddit videos) is saved, now also enqueues a thumbnail job — this path writes the asset straight to the DB and previously bypassed thumbnail generation entirely, unlike the manual-attach path |
| `packages/trpc/testUtils.ts` | *(No longer a fork change.)* The fork added `AssetPreprocessingQueue` to the shared queue mock; upstream has since added its own, wired to an observable `testQueueMocks.assetPreprocessingEnqueue`. **Merge trap:** git happily auto-merges both into the same object literal, and the duplicate key silently shadows upstream's mock with an anonymous `vi.fn()`, so assertions against it fail for no visible reason. Keep upstream's, drop ours. |
| `packages/trpc/routers/admin.test.ts` | Adds tests for `generateVideoThumbnails` and `cancelQueuedJobs`. Uses upstream's own `beforeEach` (it clears mocks and installs the search/vectorStore mocks its tests need) — `defaultBeforeEach` isn't required here, because `testUtils.ts`'s `vi.mock("@karakeep/shared-server")` is hoisted to that module's top level and so applies to every test file importing it |
| `packages/db/schema.ts` (list subscriptions) | `listSubscriptionsTable`, `listSubscriptionImportsTable` and `users.subscriptionIntervalHours` (see `0096` above) |
| `packages/shared-server/src/queues.ts` (subscriptions) | `SubscriptionQueue` and `queueSubscriptionSync()`: marks the subscription "pending" and enqueues with idempotency key `subscription:<id>`, so a sync already queued or running absorbs another request |
| `packages/trpc/routers/_app.ts` | Registers the router as `listSubscriptions` (upstream's `subscriptions` is Stripe billing) |
| `packages/shared/types/users.ts`, `packages/trpc/models/users.ts`, `apps/web/lib/userSettings.tsx` | The `subscriptionIntervalHours` user setting (0–720, 0 = only on "Sync now"), read, written and defaulted like the others |
| `packages/trpc/routers/users.test.ts` | The settings test asserts the exact shape, so it expects `subscriptionIntervalHours` (and sets it) |
| `apps/workers/index.ts` | Registers the `subscription` worker and starts/stops its cron, like the feed worker's |
| `apps/web/app/settings/layout.tsx` | "List subscriptions" entry under "RSS Subscriptions" |
| `apps/web/components/dashboard/lists/ListOptions.tsx` (subscriptions) | "Add subscription" in the "…" menu, on manual lists you can edit |
| `apps/web/components/dashboard/lists/ListOptions.tsx` (sort) | "Sort: …" submenu (`BookmarkSortSubmenu`, key `list:<id>`; Recently added on manual lists) between the actions and the view toggles (`AFTER_SORT`) |
| `packages/shared/types/bookmarks.ts` (getBookmarks sort) | `sortBy: "random" \| "addedToList"` and `shuffleSeed` on the getBookmarks input. Internal only — the REST/OpenAPI surface is unchanged (the cursor keeps its shape; see `bookmarkOrders.ts`) |
| `packages/trpc/models/bookmarks.ts` (loadMulti) | One early branch after smart lists become ids: `sortBy` hands over to `loadInForkOrder`, which loads the page back through `loadMulti` by id. Upstream's own paths are untouched |
| `packages/trpc/routers/bookmarks.test.ts` (orders) | Random covers everything once across pages, is stable per seed and survives a bookmark leaving mid-scroll; Recently added follows the join date on both the list and the sub-lists/feed paths |
| `apps/web/components/dashboard/bookmarks/Bookmarks.tsx`, `UpdatableBookmarksGrid.tsx`, `ClientBookmarksGrid.tsx` | Take the page's `sortKey`: the server grid reads its sort from the cookie (with a fresh shuffle seed per load) and loads the first page in that order; the client grid waits for hydration, then does the same. `UpdatableBookmarksGrid` uses a passed `sort` and falls back to upstream's global toggle without one |
| `apps/web/app/dashboard/{bookmarks,favourites,archive,lists/[listId],tags/[tagId],feeds/[feedId]}/page.tsx`, `lists/page.tsx` | Pass their `sortKey`; Favourites, Archive and RSS feeds get a header "…" (`BookmarkPageOptions`); All Lists gets `AllListsOptions` and hands its list order + seed to `AllListsView` |
| `apps/web/components/dashboard/GlobalActions.tsx` | The header sort toggle only on search (upstream's, with relevance); on the home feed it's the page's own sort (`PageSortButton`); elsewhere the page's "…" has it |
| `apps/web/components/dashboard/tags/TagOptions.tsx`, `tags/TagFilterView.tsx` | Sort in the tag page's "…" (`tag:<id>`); the tags page's "…" and grid (`tags`) |
| `apps/web/components/dashboard/lists/CollapsibleBookmarkLists.tsx`, `AllListsView.tsx` | `compareSiblings` prop (default: your order by `position`); All Lists passes Name / Most items / Random |
| `apps/web/components/shared/sidebar/TSidebarItem.ts`, `Sidebar.tsx`, `apps/web/app/dashboard/layout.tsx` | Sidebar items can carry a `right` slot; Archive's is its "…" |
| `apps/web/components/dashboard/preview/MediaFitPreview.tsx`, `BookmarkPreview.tsx` (details toggle) | Both previews' details toggle reads one remembered setting (`lib/previewDetails.ts`); pictures render through `ZoomableImage` |
| `packages/shared/assetdb.ts` (AVIF) | `IMAGE_AVIF` in `ASSET_TYPES` and `IMAGE_ASSET_TYPES`, so an AVIF uploads, becomes an image bookmark, and a direct AVIF link is stored as a picture. Browsers show it as it is (`AssetCard` renders assets `unoptimized`) |
| `apps/workers/workers/assetPreprocessingWorker.ts` (OCR), `apps/workers/workers/inference/tagging.ts` | Pass the image through `imageForAnalysis()` first (see `imageFormats.ts` above); JPEG/PNG/WebP/GIF go through untouched, as before |
| `apps/workers/package.json`, `pnpm-lock.yaml` | `sharp` for the workers (the lockfile gains one importer entry; the package itself was already there for the web app). tsdown leaves it external and `pnpm deploy` ships its Linux binary |
| `desktop/src/main/ingest.ts` (Magpie) | AVIF in its copy of the accepted types, and sniffed as `ftypavif`/`ftypavis` before the generic `ftyp` → MP4 rule. Vrana (separate repo) has the same list and still lacks AVIF |

## 🔴 Substantially reworked files — highest conflict risk, check these first

| File | What changed & why | Merge guidance |
|---|---|---|
| `tooling/tailwind/globals.css` | **Entire color palette replaced.** Dark theme is now a neutral charcoal + purple accent; light theme is a Pinterest-style white + red accent. Every CSS variable under `:root` and `.dark` was rewritten. | If upstream adds/renames a variable, take upstream's *variable name*, but keep **our** color *value*. If upstream only tweaks values we didn't touch, this should merge cleanly. |
| `apps/web/components/dashboard/bookmarks/TextCard.tsx` | Added a masonry-layout branch: renders `MasonryMediaCard` for video-attached text bookmarks instead of the standard card body. | If upstream changes the surrounding card logic, keep our added `layout === "masonry"` branch and reapply it around upstream's new code. |
| `apps/web/components/dashboard/bookmarks/AssetCard.tsx` | Same masonry-layout branch, for image assets. | Same approach as TextCard.tsx above. |
| `apps/web/components/dashboard/bookmarks/BookmarksGrid.tsx` | Removed the inline `EditorCard` from the grid entirely (replaced by the "+" dialog); masonry-layout cards get no border/`bg-card`; widened the `Masonry` gap 16px→20px; widened the infinite-scroll `rootMargin` so pagination fires ~1200px early. | Diff carefully — this file has four independent changes bundled in. Reapply each piece individually against upstream's version rather than doing a blind merge. |
| `apps/web/components/dashboard/bookmarks/EditorCard.tsx` | Added `inDialog`/`onCreated` props so the same component can render inside `NewBookmarkDialog` without its own card chrome (title row, fixed height). | Should merge cleanly unless upstream changes the same prop surface; if so, keep our two new optional props. |
| `apps/web/components/dashboard/lists/AllListsView.tsx` | Removed the colored accent bar and the emoji's card/border/shadow from list rows; chevron space is now only reserved for rows that actually have subfolders (was previously reserved for every row). | Re-verify the `collapsible` conditional still gates the chevron `<div>` correctly after merging. |
| `apps/web/components/dashboard/sidebar/AllLists.tsx` | Same chevron-reservation fix, for the sidebar tree; removed the default 📋/⭐ emoji icons on "All Lists"/"Favourites"; added `useDropTarget`: every drop MOVES (`addToList`, then `removeFromList` from the source list — or, dragged from a view that isn't a list such as home/search/a tag, from every manual list it's in, read fresh via `getListsOfBookmark`; existing tRPC mutations, no backend change); passes `reorderable` to the owned-lists `CollapsibleBookmarkLists` (shared lists aren't reorderable — see below). | Same as above; also re-verify `useDropTarget`'s drop handler after merging. |
| `apps/web/components/dashboard/lists/CollapsibleBookmarkLists.tsx` | Removed the two `.sort((a,b) => a.item.name.localeCompare(...))` alphabetical sorts, replaced with sorting by the new `position` field (descending — newest/most-recently-moved-up sorts first). Added `ReorderableSiblings`, a wrapper that adds HTML5 drag-and-drop reordering (with an insertion-line indicator) around a group of same-parent siblings, gated by a new `reorderable` prop (only the owned-lists tree passes `true` — reordering a shared list's row would silently reorder it for the owner too, since `position` lives on the same DB row regardless of who's viewing). | If upstream changes the sort or the recursion here, keep the `position`-based sort and re-wrap the sibling `.map()` calls (root-level and `ListItem`'s children) in `ReorderableSiblings`. |
| `packages/trpc/models/lists.ts` | Added `List.getNextPosition()` (new lists get `max(siblings) + 1`, so newest sorts first) and `List.reorder()` (moves a list to a new index among its siblings; interpolates a new `position` between its new neighbors — or beyond the top/bottom edge — so only the moved row is touched, no renumbering). `create()` now calls `getNextPosition()`. | Additive — two new methods plus one line in `create()`. Should merge cleanly unless upstream restructures `create()`, in which case keep the `position` assignment. |
| `packages/trpc/routers/lists.ts` | **Backend logic change, not cosmetic.** (1) `stats` rolls a parent (sub)folder's count up from everything nested under it (recursively, via each list's `parentId`), instead of showing only bookmarks added to the parent directly — most "parent" lists are pure organizational folders with 0 bookmarks of their own. (2) Added the `reorder` mutation (owner-only, see `List.reorder()` above). The fork's *other* `stats` change — batching all manual-list counts into one grouped SQL query instead of one query per list — is **no longer a fork change**: upstream landed the same optimisation as `List.getSizes()`, so the hand-rolled version was dropped in favour of theirs and the rollup now runs on top of it. | **The rollup is the part a careless merge silently drops.** If upstream touches `stats` again, read both versions fully — don't take "theirs" by default, since taking theirs wholesale reverts parent folders to showing 0. |
| `packages/trpc/models/assets.ts` | `attachAsset()` now enqueues an `AssetPreprocessingQueue` job (with `assetId` set) whenever a `video` asset is attached, to generate a poster-frame thumbnail. `detachAsset()` now also deletes the orphaned `linkVideoThumbnail` companion asset when its `linkVideo` is detached. | If upstream changes `attachAsset`/`detachAsset`, keep both new blocks (the `if (input.asset.assetType === "video")` enqueue, and the thumbnail-cleanup block in `detachAsset`) and reapply around upstream's version. |
| `apps/workers/workers/assetPreprocessingWorker.ts` | Added `extractAndSaveVideoThumbnail()`: probes the video's duration with `ffprobe` and seeks to **20%** in before grabbing a frame (`-ss` before `-i`, capped to 1280px wide, `-frames:v 1 -update 1`), falling back to a first-frame grab if the probe or seek fails. The 20% seek is the fix for **all-black thumbnails** — a naive first-frame grab captured the black title-card/fade-in that opens most music videos, so those rendered as black boxes in the feed (while the backfill still counted them as "has a thumbnail" since the row existed). `run()` branches early on `req.data.assetId` to target this specific-asset job type before the existing primary-asset logic (unchanged). Its asset-type gate uses the same `linkVideo`-OR-(`bookmarkAsset`-and-video-`contentType`) check as the admin query above (kept in sync manually — the two need slightly different data shapes). | Additive — a new function plus one early branch at the top of `run()`. Should merge cleanly unless upstream restructures `run()`'s dispatch, in which case keep the `req.data.assetId` branch and the new function. |
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
- [ ] Attach a video and confirm a real poster-frame thumbnail appears in the feed (not a black box) once the worker finishes; check both `ffmpeg` and `ffprobe` are present in the worker's container/environment (the thumbnail seek uses `ffprobe` for duration)
- [ ] "Regenerate all video thumbnails" (Admin → Background Jobs → Asset Preprocessing) replaces existing thumbnails — used to repair the old all-black ones; "Cancel queued jobs" on a queue card aborts an accidental bulk enqueue
- [ ] Settings → Admin → Background Jobs → Asset Preprocessing → "Generate missing video thumbnails" — confirm it enqueues only videos actually missing a thumbnail (not already-thumbnailed ones)
- [ ] Drag a sidebar list to reorder it — confirm the insertion line tracks the cursor and the new order persists after a refresh
- [ ] Open a list with subfolders — confirm its combined count (header + sidebar) equals the sum of its subfolders' counts, and the subfolder tiles at the top of the page link to the right lists
- [ ] All Lists page: no hydration error in the console (the "New list" button must be in the server's HTML, not added on hydration)
- [ ] Tailored feed: "…" → "Choose lists…" (sidebar and page) opens the picker; unticking a folder unticks everything under it and half-ticks its parent; the feed's count and tiles follow
- [ ] Sort: every page's "…" (lists, Tailored feed, Tags, Favourites, Archive, a tag, an RSS feed; the home feed's header button) has Sort. Newest/Oldest/Random (plus Recently added on lists and the feed) stick per page across reloads; Random reshuffles on every visit but not while scrolling, and moving a tile out mid-scroll neither repeats nor skips one. All Lists sorts the lists themselves (Your order / Name / Most items / Random); the sidebar keeps your order
- [ ] Preview: hide the details on one picture, open another — still hidden, until shown again. Scroll over a picture zooms at the pointer, dragging pans, − / + / reset sit bottom right; a click at normal size still opens the original
- [ ] Tags page: typing narrows the cloud, picking two tags shows only what carries both, and the URL keeps the selection; "Manage tags" still reaches the old view
- [ ] A list with sub-lists: "…" → "Show items from sub-lists" brings their items onto the parent's page and survives a reload; dragging one of those onto another list moves it out of the sub-list it was in
- [ ] List icons: no "??" anywhere (sidebar, list picker, browser extension); a new list starts with no emoji and can still be given one
- [ ] Click the header logo — it goes home; the chevron beside it folds/unfolds the sidebar and the state survives a refresh
- [ ] Hover a masonry tile — the title, action icons and (on a video) the play mark appear. If nothing appears, Tailwind 3's `group-*`/`peer-*` variants are broken again: upstream's `2d58d906` (cherry-picked here ahead of a merge) pins `tailwindcss@3.4.1>postcss-selector-parser` to 6.1.4 because 6.1.3 silently drops them
- [ ] Open an image, then a video — the modal wraps the media, the details scroll beside it, and a video autoplays exactly once (listen for doubled audio)
- [ ] In the modal's List section: hover a chip → × removes it; + adds another list; with none left it reads "Unsorted". Drag a tile onto a sidebar list: from a list view it leaves that list, from home it leaves all its lists
- [ ] Drag-and-drop a local `.mp4`/`.webm`/`.mkv` file onto the app — confirm it creates a bookmark (not "Unsupported asset type"), a poster-frame thumbnail appears in the feed within a few seconds without manual intervention, and the video plays in the feed and the preview modal
- [ ] Paste-to-save: take a screenshot snippet (`⌘⌃⇧4` macOS / `Win+Shift+S` Windows), open a manual list, press `⌘/Ctrl+V` — confirm the image is uploaded and added to that list; on the home feed it should upload without a list; and pasting into a text field / note editor should still paste text (not hijack the screenshot)
- [ ] List subscriptions: on a manual list, "…" → "Add subscription", paste a public Pinterest board link. It shows "Syncing…", then "Synced, N new"; the list fills in the board's order, the same picture pinned twice arrives once, and a board with videos brings `.mp4` videos (not their covers). "Sync now" again adds nothing; removing the board and adding it back downloads nothing. Settings → List subscriptions changes the schedule. If a sync fails with HTTP 403, Pinterest changed its front-end — see `connectors/pinterest.ts`
- [ ] AVIF: drop an `.avif` on a list — it becomes an image bookmark that shows in the grid and the preview, and OCR/AI tagging don't fail on it
- [ ] Deploy to the NAS and re-test against the real, large dataset before calling it done — several of these bugs only reproduced at real scale (thousands of bookmarks, 100+ lists), not against small local test data
