"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/client";
import { Plus } from "lucide-react";

import EditorCard from "./EditorCard";

/**
 * A "+" button that opens a dialog for creating a new bookmark (link / note /
 * pasted image) — replacing the inline editor card in the grid. Reuses the
 * existing EditorCard so behaviour (multi-URL import, add-to-current-list via
 * the create post-hook, image paste) stays identical.
 */
export default function NewBookmarkDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

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
          </DialogHeader>
          <EditorCard inDialog onCreated={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
