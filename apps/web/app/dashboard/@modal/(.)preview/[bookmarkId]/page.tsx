"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import BookmarkPreview from "@/components/dashboard/preview/BookmarkPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export default function BookmarkPreviewPage(props: {
  params: Promise<{ bookmarkId: string }>;
}) {
  const params = use(props.params);
  const router = useRouter();

  const [open, setOpen] = useState(true);

  const setOpenWithRouter = (value: boolean) => {
    setOpen(value);
    if (!value) {
      router.back();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpenWithRouter}>
      <VisuallyHidden>
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
        </DialogHeader>
      </VisuallyHidden>
      {/* Sized by its content: BookmarkPreview's "modal" variant wraps a
          picture or video, and gives everything else a 90% box. */}
      <DialogContent
        className="w-auto max-w-[95vw] gap-0 overflow-hidden rounded-xl p-0"
        // Darker than other dialogs: a picture or video should sit against
        // near-black, not a half-lit feed.
        overlayClassName="bg-black/95"
        hideCloseBtn={true}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <BookmarkPreview
          bookmarkId={params.bookmarkId}
          variant="modal"
          onClose={() => setOpenWithRouter(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
