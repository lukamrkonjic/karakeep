import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useShowArchived } from "@/components/utils/useShowArchived";
import { useShowSublists } from "@/components/utils/useShowSublists";
import { useTranslation } from "@/lib/i18n/client";
import {
  DoorOpen,
  FolderInput,
  Pencil,
  Plus,
  Rss,
  Share,
  Square,
  SquareCheck,
  Trash2,
  Users,
} from "lucide-react";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { ZBookmarkList } from "@karakeep/shared/types/lists";

import { EditListModal } from "../lists/EditListModal";
import { BookmarkSortSubmenu } from "../sort/SortSubmenu";
import DeleteListConfirmationDialog from "./DeleteListConfirmationDialog";
import LeaveListConfirmationDialog from "./LeaveListConfirmationDialog";
import { ListSubscriptionsModal } from "./ListSubscriptionsModal";
import { ManageCollaboratorsModal } from "./ManageCollaboratorsModal";
import { MergeListModal } from "./MergeListModal";
import { ShareListModal } from "./ShareListModal";

// The view toggles and the leave/delete actions come after "Sort".
const AFTER_SORT = new Set([
  "toggle-sublists",
  "toggle-archived",
  "leave-list",
  "delete",
]);

export function ListOptions({
  list,
  isOpen,
  onOpenChange,
  children,
}: {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  list: ZBookmarkList;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { showArchived, onClickShowArchived } = useShowArchived();
  const { showSublists, onClickShowSublists } = useShowSublists(list.id);
  // Only worth offering on a list that has something nested under it.
  const { data: allLists } = useBookmarkLists();
  const hasSublists = !!allLists?.data.some((l) => l.parentId === list.id);

  const [deleteListDialogOpen, setDeleteListDialogOpen] = useState(false);
  const [leaveListDialogOpen, setLeaveListDialogOpen] = useState(false);
  const [newNestedListModalOpen, setNewNestedListModalOpen] = useState(false);
  const [mergeListModalOpen, setMergeListModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [collaboratorsModalOpen, setCollaboratorsModalOpen] = useState(false);
  const [subscriptionsModalOpen, setSubscriptionsModalOpen] = useState(false);

  // Only owners can manage the list (edit, delete, manage collaborators, etc.)
  const isOwner = list.userRole === "owner";
  // Collaborators (non-owners) can leave the list
  const isCollaborator =
    list.userRole === "editor" || list.userRole === "viewer";

  // Define action items array
  const actionItems = [
    {
      id: "edit",
      title: t("actions.edit"),
      icon: <Pencil className="size-4" />,
      visible: isOwner,
      disabled: false,
      onClick: () => setEditModalOpen(true),
    },
    {
      id: "share",
      title: t("lists.share_list"),
      icon: <Share className="size-4" />,
      visible: isOwner,
      disabled: false,
      onClick: () => setShareModalOpen(true),
    },
    {
      id: "manage-collaborators",
      title: isOwner
        ? t("lists.collaborators.manage")
        : t("lists.collaborators.view"),
      icon: <Users className="size-4" />,
      visible: list.type === "manual",
      disabled: false,
      onClick: () => setCollaboratorsModalOpen(true),
    },
    {
      id: "new-nested-list",
      title: t("lists.new_nested_list"),
      icon: <Plus className="size-4" />,
      visible: isOwner,
      disabled: false,
      onClick: () => setNewNestedListModalOpen(true),
    },
    {
      id: "merge-list",
      title: t("lists.merge_list"),
      icon: <FolderInput className="size-4" />,
      visible: isOwner,
      disabled: false,
      onClick: () => setMergeListModalOpen(true),
    },
    {
      id: "subscriptions",
      title: t("lists.add_subscription", { defaultValue: "Add subscription" }),
      icon: <Rss className="size-4" />,
      // A subscription writes into the list, so only where you may write.
      visible:
        list.type === "manual" && (isOwner || list.userRole === "editor"),
      disabled: false,
      onClick: () => setSubscriptionsModalOpen(true),
    },
    {
      id: "toggle-sublists",
      title: t("lists.show_sublist_items", {
        defaultValue: "Show items from sub-lists",
      }),
      icon: showSublists ? (
        <SquareCheck className="size-4" />
      ) : (
        <Square className="size-4" />
      ),
      visible: hasSublists && list.type === "manual",
      disabled: false,
      onClick: onClickShowSublists,
    },
    {
      id: "toggle-archived",
      title: t("actions.toggle_show_archived"),
      icon: showArchived ? (
        <SquareCheck className="size-4" />
      ) : (
        <Square className="size-4" />
      ),
      visible: isOwner,
      disabled: false,
      onClick: onClickShowArchived,
    },
    {
      id: "leave-list",
      title: t("lists.leave_list.action"),
      icon: <DoorOpen className="size-4" />,
      visible: isCollaborator,
      disabled: false,
      className: "flex gap-2 text-destructive",
      onClick: () => setLeaveListDialogOpen(true),
    },
    {
      id: "delete",
      title: t("actions.delete"),
      icon: <Trash2 className="size-4" />,
      visible: isOwner,
      disabled: false,
      className: "flex gap-2 text-destructive",
      onClick: () => setDeleteListDialogOpen(true),
    },
  ];

  // Filter visible items
  const visibleItems = actionItems.filter((item) => item.visible);

  // If no items are visible, don't render the dropdown
  if (visibleItems.length === 0) {
    return null;
  }

  const renderItem = (item: (typeof visibleItems)[number]) => (
    <DropdownMenuItem
      key={item.id}
      className={item.className ?? "flex gap-2"}
      disabled={item.disabled}
      onClick={item.onClick}
    >
      {item.icon}
      <span>{item.title}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      <ShareListModal
        open={shareModalOpen}
        setOpen={setShareModalOpen}
        list={list}
      />
      <ManageCollaboratorsModal
        open={collaboratorsModalOpen}
        setOpen={setCollaboratorsModalOpen}
        list={list}
        readOnly={!isOwner}
      />
      <EditListModal
        open={newNestedListModalOpen}
        setOpen={setNewNestedListModalOpen}
        prefill={{
          parentId: list.id,
        }}
      />
      <EditListModal
        open={editModalOpen}
        setOpen={setEditModalOpen}
        list={list}
      />
      <MergeListModal
        open={mergeListModalOpen}
        setOpen={setMergeListModalOpen}
        list={list}
      />
      <ListSubscriptionsModal
        open={subscriptionsModalOpen}
        setOpen={setSubscriptionsModalOpen}
        listId={list.id}
      />
      <DeleteListConfirmationDialog
        list={list}
        open={deleteListDialogOpen}
        setOpen={setDeleteListDialogOpen}
      />
      <LeaveListConfirmationDialog
        list={list}
        open={leaveListDialogOpen}
        setOpen={setLeaveListDialogOpen}
      />
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent>
        {visibleItems
          .filter((item) => !AFTER_SORT.has(item.id))
          .map(renderItem)}
        {/* Fork: this list page's order ("Recently added" = when a
            bookmark joined it; smart lists have no such date). */}
        <BookmarkSortSubmenu
          pageKey={`list:${list.id}`}
          withRecentlyAdded={list.type === "manual"}
        />
        {visibleItems.filter((item) => AFTER_SORT.has(item.id)).map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
