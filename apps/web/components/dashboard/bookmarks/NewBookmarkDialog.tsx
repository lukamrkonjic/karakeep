"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canAddToList, usePageList } from "@/lib/hooks/useAddToCurrentList";
import { useTranslation } from "@/lib/i18n/client";
import { Plus } from "lucide-react";

import { BookmarkListContext } from "@karakeep/shared-react/hooks/bookmark-list-context";

import EditorCard from "./EditorCard";

/**
 * A "+" button that opens a dialog for creating a new bookmark (link / note /
 * pasted image) — replacing the inline editor card in the grid. Reuses the
 * existing EditorCard so behaviour (multi-URL import, image paste) stays
 * identical.
 *
 * On a list's page whatever it saves goes into that list — from the list's
 * own "+" and from the header's, which sits outside the page's list context
 * (usePageList finds the list from the address): the dialog sets the
 * context for EditorCard, whose links, notes and uploads add themselves to
 * it (useAddToCurrentList).
 */
export default function NewBookmarkDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pageList = usePageList();
  const list = canAddToList(pageList) ? pageList : undefined;

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={t("editor.new_item")}
        title={t("editor.new_item")}
      >
        <Plus />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("editor.new_item")}</DialogTitle>
            {list && (
              <DialogDescription>Goes into {list.name}</DialogDescription>
            )}
          </DialogHeader>
          <BookmarkListContext.Provider value={list}>
            <EditorCard inDialog onCreated={() => setOpen(false)} />
          </BookmarkListContext.Provider>
        </DialogContent>
      </Dialog>
    </>
  );
}
