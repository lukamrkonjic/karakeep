import { memo, useEffect, useMemo, useState } from "react";
import KeyboardShortcutsDialog from "@/components/dashboard/KeyboardShortcutsDialog";
import NoBookmarksBanner from "@/components/dashboard/bookmarks/NoBookmarksBanner";
import { ActionButton } from "@/components/ui/action-button";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { useSession } from "@/lib/auth/client";
import useBulkActionsStore from "@/lib/bulkActions";
import { useLongPress } from "@/lib/hooks/useLongPress";
import {
  selectRangeTo,
  startSelection,
  toggleSelection,
} from "@/lib/selection";
import { useCardSheetStore } from "@/lib/store/useCardSheetStore";
import { useBookmarkKeyboardNavigation } from "@/lib/hooks/useBookmarkKeyboardNavigation";
import { useTranslation } from "@/lib/i18n/client";
import { useInBookmarkGridStore } from "@/lib/store/useInBookmarkGridStore";
import { useKeyboardNavigationStore } from "@/lib/store/useKeyboardNavigationStore";
import {
  bookmarkLayoutSwitch,
  useBookmarkLayout,
  useGridColumns,
  useMobileGridColumns,
} from "@/lib/userLocalSettings/bookmarksLayout";
import { cn } from "@/lib/utils";
import tailwindConfig from "@/tailwind.config";
import { Slot } from "@radix-ui/react-slot";
import { ErrorBoundary } from "react-error-boundary";
import { useInView } from "react-intersection-observer";
import Masonry from "react-masonry-css";
import resolveConfig from "tailwindcss/resolveConfig";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useBookmarkListContext } from "@karakeep/shared-react/hooks/bookmark-list-context";

import BookmarkCard from "./BookmarkCard";
import { GridSelection } from "./GridSelection";
import UnknownCard from "./UnknownCard";

function StyledBookmarkCard({
  children,
  className,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  // Masonry tiles are pure media (see MasonryMediaCard) — Pinterest-style,
  // no card chrome around them. Other layouts still need a background to
  // frame text notes and links, but no border (flat, app-wide).
  const layout = useBookmarkLayout();
  return (
    <Slot
      className={cn(
        // Fork: tighter on a phone; no iOS long-press callout on a card
        // (a long press opens its actions), no text selection by touch.
        "mb-2 [-webkit-touch-callout:none] sm:mb-5 [@media(pointer:coarse)]:select-none",
        layout === "masonry" ? "bg-transparent" : "bg-card",
        className,
      )}
      {...props}
    >
      {children}
    </Slot>
  );
}

const BookmarkGridItem = memo(function BookmarkGridItem({
  bookmark,
  index,
}: {
  bookmark: ZBookmark;
  index: number;
}) {
  const isFocused = useKeyboardNavigationStore(
    (state) => state.isNavigating && state.focusedIndex === index,
  );
  // Fork: a long press by touch opens the card's actions (BookmarkOptions'
  // sheet); with a mouse it starts selecting, with this card picked. A
  // Ctrl/⌘-click picks or unpicks a card, a Shift-click everything since the
  // last one picked (lib/selection.ts) — your own bookmarks only, as the
  // selection's round boxes.
  const openActions = useCardSheetStore((state) => state.open);
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const canSelect = bookmark.userId === userId;
  const longPress = useLongPress(
    () => openActions(bookmark.id),
    undefined,
    canSelect
      ? () => {
          if (!useBulkActionsStore.getState().isBulkEditEnabled) {
            startSelection(bookmark.id);
          }
        }
      : undefined,
  );
  const onClickCapture = (e: React.MouseEvent) => {
    longPress.onClickCapture(e);
    if (e.isPropagationStopped() || !canSelect) {
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      selectRangeTo(bookmark.id, (b) => b.userId === userId);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelection(bookmark.id);
    }
  };

  return (
    <ErrorBoundary fallback={<UnknownCard bookmark={bookmark} />}>
      <div
        className="contents"
        role="presentation"
        {...longPress}
        onClickCapture={onClickCapture}
        // A Shift-click picks a range; it mustn't also select the text
        // between.
        onMouseDown={(e) => {
          if (e.shiftKey && canSelect) {
            e.preventDefault();
          }
        }}
      >
        <StyledBookmarkCard
          className={cn(
            isFocused &&
              "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <BookmarkCard bookmark={bookmark} bookmarkIndex={index} />
        </StyledBookmarkCard>
      </div>
    </ErrorBoundary>
  );
});

function getBreakpointConfig(userColumns: number, phoneColumns: number) {
  const fullConfig = resolveConfig(tailwindConfig);

  const breakpointColumnsObj: { [key: number]: number; default: number } = {
    default: userColumns,
  };

  // Responsive behavior: reduce columns on smaller screens
  const lgColumns = Math.max(1, Math.min(userColumns, userColumns - 1));
  const mdColumns = Math.max(1, Math.min(userColumns, 2));
  // Fork: a phone has its own setting (it used to be always 1).
  const smColumns = phoneColumns;

  breakpointColumnsObj[parseInt(fullConfig.theme.screens.lg)] = lgColumns;
  breakpointColumnsObj[parseInt(fullConfig.theme.screens.md)] = mdColumns;
  breakpointColumnsObj[parseInt(fullConfig.theme.screens.sm)] = smColumns;
  return breakpointColumnsObj;
}

function getColumnsForViewport(
  userColumns: number,
  phoneColumns: number,
  viewportWidth: number,
) {
  const fullConfig = resolveConfig(tailwindConfig);
  const screens = fullConfig.theme.screens;
  const lg = parseInt(screens.lg);
  const md = parseInt(screens.md);
  const sm = parseInt(screens.sm);

  if (viewportWidth <= sm) {
    return phoneColumns;
  }
  if (viewportWidth <= md) {
    return Math.max(1, Math.min(userColumns, 2));
  }
  if (viewportWidth <= lg) {
    return Math.max(1, userColumns - 1);
  }
  return userColumns;
}

function useActiveGridColumns(userColumns: number, phoneColumns: number) {
  const [activeColumns, setActiveColumns] = useState(userColumns);

  useEffect(() => {
    let animationFrame: number | null = null;
    const updateActiveColumns = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setActiveColumns(
          getColumnsForViewport(userColumns, phoneColumns, window.innerWidth),
        );
      });
    };

    const updateActiveColumnsImmediately = () => {
      setActiveColumns(
        getColumnsForViewport(userColumns, phoneColumns, window.innerWidth),
      );
    };

    updateActiveColumnsImmediately();
    window.addEventListener("resize", updateActiveColumns);
    return () => {
      window.removeEventListener("resize", updateActiveColumns);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [userColumns, phoneColumns]);

  return activeColumns;
}

export default function BookmarksGrid({
  bookmarks,
  hasNextPage = false,
  fetchNextPage = () => ({}),
  isFetchingNextPage = false,
  showEditorCard = false,
}: {
  bookmarks: ZBookmark[];
  showEditorCard?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
}) {
  const { t } = useTranslation();
  const layout = useBookmarkLayout();
  const gridColumns = useGridColumns();
  const phoneColumns = useMobileGridColumns();
  const activeGridColumns = useActiveGridColumns(gridColumns, phoneColumns);
  const setVisibleBookmarks = useBulkActionsStore(
    (state) => state.setVisibleBookmarks,
  );
  const setListContext = useBulkActionsStore((state) => state.setListContext);
  const setInBookmarkGrid = useInBookmarkGridStore(
    (state) => state.setInBookmarkGrid,
  );
  const withinListContext = useBookmarkListContext();
  const breakpointConfig = useMemo(
    () => getBreakpointConfig(gridColumns, phoneColumns),
    [gridColumns, phoneColumns],
  );
  // Fire well before the sentinel actually reaches the viewport: masonry
  // columns have uneven heights, and on a slow connection/server the
  // "load more" request can end up queued behind a burst of in-flight
  // thumbnail/video requests from tiles scrolling into view. Triggering
  // early gives it a head start instead of only firing once the user has
  // already scrolled all the way to the bottom.
  const { ref: loadMoreRef, inView: loadMoreButtonInView } = useInView({
    rootMargin: "1200px 0px",
  });

  // For list/compact layouts, navigation is single-column
  const isListLayout = layout === "list" || layout === "compact";
  const navColumns = isListLayout ? 1 : activeGridColumns;

  const {
    helpDialogOpen,
    setHelpDialogOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    isBulkDelete,
    deleteCount,
    confirmDelete,
    isDeletePending,
  } = useBookmarkKeyboardNavigation({
    bookmarks,
    columns: navColumns,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  useEffect(() => {
    setVisibleBookmarks(bookmarks);
    setListContext(withinListContext);

    return () => {
      setVisibleBookmarks([]);
      setListContext(undefined);
    };
  }, [bookmarks, setListContext, setVisibleBookmarks, withinListContext]);

  useEffect(() => {
    setInBookmarkGrid(true);
    return () => {
      setInBookmarkGrid(false);
    };
  }, [setInBookmarkGrid]);

  useEffect(() => {
    if (loadMoreButtonInView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loadMoreButtonInView]);

  if (bookmarks.length == 0 && !showEditorCard) {
    return (
      <>
        <NoBookmarksBanner />
        <KeyboardShortcutsDialog
          open={helpDialogOpen}
          setOpen={setHelpDialogOpen}
        />
      </>
    );
  }

  // The inline editor card was replaced by a "+" dialog in the headers
  // (NewBookmarkDialog); showEditorCard now only drives the upload dropzone and
  // the empty-state banner.
  const children = bookmarks.map((bookmark, index) => (
    <BookmarkGridItem key={bookmark.id} bookmark={bookmark} index={index} />
  ));
  return (
    <>
      <GridSelection />
      {bookmarkLayoutSwitch(layout, {
        // Fork: an 8px gutter on a phone (it has 2–4 columns now).
        masonry: (
          <Masonry
            className="-ml-2 flex w-auto sm:-ml-5"
            columnClassName="pl-2 sm:pl-5"
            breakpointCols={breakpointConfig}
          >
            {children}
          </Masonry>
        ),
        grid: (
          <Masonry
            className="-ml-2 flex w-auto sm:-ml-5"
            columnClassName="pl-2 sm:pl-5"
            breakpointCols={breakpointConfig}
          >
            {children}
          </Masonry>
        ),
        list: <div className="grid grid-cols-1">{children}</div>,
        compact: <div className="grid grid-cols-1">{children}</div>,
      })}
      {hasNextPage && (
        <div className="flex justify-center">
          <ActionButton
            ref={loadMoreRef}
            ignoreDemoMode={true}
            loading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
            variant="ghost"
          >
            Load More
          </ActionButton>
        </div>
      )}

      <KeyboardShortcutsDialog
        open={helpDialogOpen}
        setOpen={setHelpDialogOpen}
      />

      <ActionConfirmingDialog
        open={deleteDialogOpen}
        setOpen={setDeleteDialogOpen}
        title={t("dialogs.bookmarks.delete_confirmation_title")}
        description={
          isBulkDelete
            ? t("dialogs.bookmarks.bulk_delete_confirmation_description", {
                count: deleteCount,
              })
            : t("dialogs.bookmarks.delete_confirmation_description")
        }
        actionButton={() => (
          <ActionButton
            type="button"
            variant="destructive"
            loading={isDeletePending}
            onClick={confirmDelete}
          >
            {t("actions.delete")}
          </ActionButton>
        )}
      />
    </>
  );
}
