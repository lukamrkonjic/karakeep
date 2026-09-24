"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { pictureUrlOf } from "@/lib/bookmarkDragImage";
import { useSession } from "@/lib/auth/client";
import useBulkActionsStore from "@/lib/bulkActions";
import { useBookmarkBulkMutations } from "@/lib/hooks/useBookmarkBulkActions";
import type { UpdateBookmarkProps } from "@/lib/hooks/useBookmarkBulkActions";
import { useTranslation } from "@/lib/i18n/client";
import { selectAllLoaded, setSelection } from "@/lib/selection";
import {
  CheckCheck,
  FileDown,
  FileText,
  Hash,
  Link,
  ListMinus,
  ListPlus,
  MoreHorizontal,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";

import BulkManageListsModal from "./bookmarks/BulkManageListsModal";
import BulkTagModal from "./bookmarks/BulkTagModal";
import { ArchivedActionIcon, FavouritedActionIcon } from "./bookmarks/icons";

export default function BulkBookmarksAction() {
  const { t } = useTranslation();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRemoveFromListDialogOpen, setIsRemoveFromListDialogOpen] =
    useState(false);
  const [manageListsModal, setManageListsModalOpen] = useState(false);
  const [bulkTagModal, setBulkTagModalOpen] = useState(false);
  // Fork: the pictures of what's about to be deleted, for the dialog.
  const [deletePreview, setDeletePreview] = useState<{
    urls: (string | null)[];
    more: number;
  }>({ urls: [], more: 0 });
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const pathname = usePathname();
  const currentPathnameRef = useRef(pathname);

  const onError = () => {
    toast({
      variant: "destructive",
      title: "Something went wrong",
      description: "There was a problem with your request.",
    });
  };
  const bulkActionsStore = useBulkActionsStore();
  const selectedBookmarks = bulkActionsStore.getSelectedBookmarks();
  const {
    isBulkEditEnabled,
    listContext: withinListContext,
    setIsBulkEditEnabled,
    isEverythingSelected,
  } = bulkActionsStore;
  const {
    updateBookmarkMutator,
    deleteBookmarkMutator,
    recrawlBookmarkMutator,
    removeBookmarkFromListMutator,
    updateSelectedBookmarks,
    deleteSelectedBookmarks,
    recrawlSelectedLinkBookmarks,
    removeSelectedBookmarksFromList,
    selectedBookmarkLinksText,
  } = useBookmarkBulkMutations({
    selectedBookmarks,
    listContext: withinListContext,
    onError,
    onBulkEditDone: () => {
      setIsBulkEditEnabled(false);
    },
  });

  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  // Reset bulk edit state when the route changes
  useEffect(() => {
    if (pathname !== currentPathnameRef.current) {
      currentPathnameRef.current = pathname;
      setIsBulkEditEnabled(false);
    }
  }, [pathname, setIsBulkEditEnabled]);

  const recrawlBookmarks = async (archiveFullPage: boolean) => {
    const links = await recrawlSelectedLinkBookmarks(archiveFullPage);
    toast({
      description: `${links.length} bookmarks will be ${archiveFullPage ? "re-crawled and archived!" : "refreshed!"}`,
    });
  };

  function isClipboardAvailable() {
    if (typeof window === "undefined") {
      return false;
    }
    return window && window.navigator && window.navigator.clipboard;
  }

  const copyLinks = async () => {
    if (!isClipboardAvailable()) {
      toast({
        description: `Copying is only available over https`,
      });
      return;
    }
    await navigator.clipboard.writeText(selectedBookmarkLinksText());

    toast({
      description: `Added ${selectedBookmarks.length} bookmark links into the clipboard!`,
    });
  };

  const updateBookmarks = async ({
    favourited,
    archived,
  }: UpdateBookmarkProps) => {
    await updateSelectedBookmarks({ favourited, archived });
    setIsBulkEditEnabled(false);
    toast({
      description: `${selectedBookmarks.length} bookmarks have been updated!`,
    });
  };

  const deleteBookmarks = async () => {
    await deleteSelectedBookmarks();
    toast({
      description: `${selectedBookmarks.length} bookmarks have been deleted!`,
    });
    setIsDeleteDialogOpen(false);
  };

  const removeBookmarksFromList = async () => {
    if (!withinListContext) return;

    const results = await removeSelectedBookmarksFromList();

    const successes = results.filter((r) => r.status === "fulfilled").length;
    if (successes > 0) {
      toast({
        description: `${successes} bookmarks have been removed from the list!`,
      });
    }
    setIsRemoveFromListDialogOpen(false);
  };

  const alreadyFavourited =
    selectedBookmarks.length &&
    selectedBookmarks.every((item) => item.favourited === true);

  const alreadyArchived =
    selectedBookmarks.length &&
    selectedBookmarks.every((item) => item.archived === true);

  const count = selectedBookmarks.length;
  const everything = isEverythingSelected();
  const canRemoveFromList =
    !!withinListContext &&
    withinListContext.type === "manual" &&
    (withinListContext.userRole === "editor" ||
      withinListContext.userRole === "owner");

  // Fork: done to many less often, so behind the card's "…".
  const moreActions = [
    {
      name: t("actions.edit_tags"),
      icon: <Hash className="size-4" />,
      action: () => setBulkTagModalOpen(true),
      isPending: false,
    },
    {
      name: alreadyFavourited ? t("actions.unfavorite") : t("actions.favorite"),
      icon: <FavouritedActionIcon favourited={!!alreadyFavourited} size={16} />,
      action: () => updateBookmarks({ favourited: !alreadyFavourited }),
      isPending: updateBookmarkMutator.isPending,
    },
    {
      name: alreadyArchived ? t("actions.unarchive") : t("actions.archive"),
      icon: <ArchivedActionIcon size={16} archived={!!alreadyArchived} />,
      action: () => updateBookmarks({ archived: !alreadyArchived }),
      isPending: updateBookmarkMutator.isPending,
    },
    {
      name: isClipboardAvailable()
        ? t("actions.copy_link")
        : "Copying is only available over https",
      icon: <Link className="size-4" />,
      action: () => copyLinks(),
      isPending: false,
    },
    {
      name: t("actions.refresh"),
      icon: <RotateCw className="size-4" />,
      action: () => recrawlBookmarks(false),
      isPending: recrawlBookmarkMutator.isPending,
    },
    {
      name: t("actions.preserve_offline_archive"),
      icon: <FileDown className="size-4" />,
      action: () => recrawlBookmarks(true),
      isPending: recrawlBookmarkMutator.isPending,
    },
  ];

  // Select all: every loaded bookmark of yours (as Ctrl/⌘+A).
  const userId = useSession().data?.user?.id;
  const toggleAll = () =>
    everything ? setSelection([]) : selectAllLoaded((b) => b.userId === userId);

  // The pictures come from the cards on screen (whatever each one shows).
  const openDeleteDialog = () => {
    const { visibleBookmarks } = useBulkActionsStore.getState();
    const indexOf = new Map(visibleBookmarks.map((b, i) => [b.id, i]));
    const shown = selectedBookmarks.slice(0, 6);
    setDeletePreview({
      urls: shown.map((bookmark) => {
        const card = document.querySelector<HTMLElement>(
          `[data-bookmark-index="${indexOf.get(bookmark.id)}"]`,
        );
        return card ? pictureUrlOf(card) : null;
      }),
      more: count - shown.length,
    });
    setIsDeleteDialogOpen(true);
  };

  const isModalOpen =
    isDeleteDialogOpen ||
    isRemoveFromListDialogOpen ||
    manageListsModal ||
    bulkTagModal;

  return (
    <div>
      <ActionConfirmingDialog
        open={isDeleteDialogOpen}
        setOpen={setIsDeleteDialogOpen}
        title={`Delete ${count} ${count === 1 ? "item" : "items"}?`}
        description={
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {deletePreview.urls.map((url, i) =>
                url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the card's own picture, already loaded
                  <img
                    key={i}
                    src={url}
                    alt=""
                    className="size-12 rounded-md object-cover"
                  />
                ) : (
                  <span
                    key={i}
                    className="flex size-12 items-center justify-center rounded-md bg-muted text-muted-foreground"
                  >
                    <FileText className="size-5" />
                  </span>
                ),
              )}
              {deletePreview.more > 0 && (
                <span className="flex size-12 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground">
                  +{deletePreview.more}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              This can&apos;t be undone.
            </p>
          </div>
        }
        actionButton={() => (
          <ActionButton
            type="button"
            variant="destructive"
            loading={deleteBookmarkMutator.isPending}
            onClick={() => deleteBookmarks()}
          >
            {t("actions.delete")}
          </ActionButton>
        )}
      />
      <ActionConfirmingDialog
        open={isRemoveFromListDialogOpen}
        setOpen={setIsRemoveFromListDialogOpen}
        title={"Remove Bookmarks from List"}
        description={
          <p>
            Are you sure you want to remove {selectedBookmarks.length} bookmarks
            from this list?
          </p>
        }
        actionButton={() => (
          <ActionButton
            type="button"
            variant="destructive"
            loading={removeBookmarkFromListMutator.isPending}
            onClick={() => removeBookmarksFromList()}
          >
            {t("actions.remove")}
          </ActionButton>
        )}
      />
      <BulkManageListsModal
        bookmarkIds={selectedBookmarks.map((b) => b.id)}
        open={manageListsModal}
        setOpen={setManageListsModalOpen}
      />
      <BulkTagModal
        bookmarkIds={selectedBookmarks.map((b) => b.id)}
        open={bulkTagModal}
        setOpen={setBulkTagModalOpen}
      />
      {/* Fork: a card at the bottom while selecting, in the look of the
          app's menus — ✕ to stop, how many are picked (a chip in the blue
          of the picked cards' ticks), Select all, then what to do with them:
          add to a list, remove from this one, delete; the rest behind "…".
          On a phone it sits above the tab bar. */}
      {portalContainer && isBulkEditEnabled && !isModalOpen
        ? createPortal(
            <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-[70] flex justify-center sm:inset-x-4 sm:bottom-6">
              <div
                aria-label={t("actions.bulk_edit")}
                className="flex max-w-full items-center gap-0.5 rounded-xl border bg-popover/95 p-1 text-popover-foreground shadow-lg shadow-black/10 backdrop-blur duration-200 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
                role="toolbar"
              >
                <Button
                  variant="ghost"
                  size="none"
                  className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                  aria-label={t("actions.close_bulk_edit")}
                  title="Done (Esc)"
                  onClick={() => setIsBulkEditEnabled(false)}
                >
                  <X className="size-4" />
                </Button>
                {count > 0 ? (
                  <span className="mx-1 inline-flex h-6 shrink-0 items-center rounded-full bg-primary px-2.5 text-xs font-semibold tabular-nums text-primary-foreground">
                    {count}
                    <span className="hidden sm:inline">&nbsp;selected</span>
                  </span>
                ) : (
                  <span className="mx-1.5 min-w-0 truncate text-sm text-muted-foreground">
                    <span className="sm:hidden">Tap items to select</span>
                    <span className="hidden sm:inline">
                      Click items, or drag a box around them
                    </span>
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="none"
                  className="hidden h-8 shrink-0 rounded-lg px-2.5 text-sm sm:inline-flex"
                  onClick={toggleAll}
                >
                  {everything ? "Deselect all" : "Select all"}
                </Button>
                <span
                  aria-hidden
                  className="mx-1 h-5 w-px shrink-0 bg-border"
                />
                <Button
                  variant="ghost"
                  size="none"
                  className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-sm sm:px-2.5"
                  disabled={count === 0}
                  title={t("actions.add_to_list")}
                  onClick={() => setManageListsModalOpen(true)}
                >
                  <ListPlus className="size-4" />
                  Add to
                </Button>
                {canRemoveFromList && (
                  <Button
                    variant="ghost"
                    size="none"
                    className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-sm sm:px-2.5"
                    disabled={count === 0}
                    title={t("actions.remove_from_list")}
                    onClick={() => setIsRemoveFromListDialogOpen(true)}
                  >
                    <ListMinus className="size-4" />
                    Remove from
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="none"
                  className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive sm:px-2.5"
                  disabled={count === 0}
                  title={t("actions.delete")}
                  onClick={openDeleteDialog}
                >
                  <Trash2 className="size-4" />
                  <span className="hidden sm:inline">
                    {t("actions.delete")}
                  </span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="none"
                      className="size-8 shrink-0 rounded-lg"
                      aria-label="More actions"
                      title="More actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end">
                    <DropdownMenuItem
                      className="flex gap-2 sm:hidden"
                      onClick={toggleAll}
                    >
                      <CheckCheck className="size-4" />
                      <span>{everything ? "Deselect all" : "Select all"}</span>
                    </DropdownMenuItem>
                    {moreActions.map(({ name, icon, action, isPending }) => (
                      <DropdownMenuItem
                        key={name}
                        className="flex gap-2"
                        disabled={count === 0 || isPending}
                        onClick={action}
                      >
                        {icon}
                        <span>{name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>,
            portalContainer,
          )
        : null}
    </div>
  );
}
