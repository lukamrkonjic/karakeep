"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Download, Trash2 } from "lucide-react";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { useUpdateBookmark } from "@karakeep/shared-react/hooks/bookmarks";

import DeleteBookmarkConfirmationDialog from "../bookmarks/DeleteBookmarkConfirmationDialog";
import { ArchivedActionIcon } from "../bookmarks/icons";

/**
 * Fork: the details panel's footer — Download (the picture, video or PDF the
 * bookmark is; Eagle's Export), Archive and Delete, labelled and left-aligned
 * under a divider, like the rest of the panel. It replaced upstream's centred
 * icon row (ActionBar): every field is edited in place now, so its edit
 * button went, and the favourite star is a Properties row.
 */
export function PreviewActions({
  bookmark,
  canEdit,
  download,
}: {
  bookmark: ZBookmark;
  /** Archive and Delete are the owner's. */
  canEdit: boolean;
  download?: { href: string; fileName?: string };
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const { mutate: archive, isPending } = useUpdateBookmark({
    onSuccess: (resp) => {
      toast({
        description: `The bookmark has been ${resp.archived ? "Archived" : "Un-archived"}!`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Something went wrong",
        description: "There was a problem with your request.",
      });
    },
  });

  const button = "h-8 gap-2 px-2 text-sm font-normal text-muted-foreground";
  if (!download && !canEdit) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      <Separator />
      {/* -ml-2: the icons line up with the fields above, not the buttons' padding. */}
      <div className="-ml-2 flex items-center gap-1">
        {download && (
          <Button
            asChild
            variant="ghost"
            size="none"
            className={cn(button, "hover:text-foreground")}
          >
            <a href={download.href} download={download.fileName ?? true}>
              <Download size={16} strokeWidth={1.75} />
              {t("actions.download", { defaultValue: "Download" })}
            </a>
          </Button>
        )}
        {canEdit && (
          <>
            <Button
              variant="ghost"
              size="none"
              disabled={isPending}
              className={cn(button, "hover:text-foreground")}
              onClick={() =>
                archive({
                  bookmarkId: bookmark.id,
                  archived: !bookmark.archived,
                })
              }
            >
              <ArchivedActionIcon
                archived={bookmark.archived}
                size={16}
                strokeWidth={1.75}
              />
              {bookmark.archived
                ? t("actions.unarchive")
                : t("actions.archive")}
            </Button>
            <Button
              variant="ghost"
              size="none"
              className={cn(
                button,
                "hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} strokeWidth={1.75} />
              {t("actions.delete")}
            </Button>
          </>
        )}
      </div>
      <DeleteBookmarkConfirmationDialog
        bookmark={bookmark}
        open={deleting}
        setOpen={setDeleting}
      />
    </div>
  );
}
