"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import BookmarkPreview from "@/components/dashboard/preview/BookmarkPreview";
import { useIsPhone } from "@/lib/hooks/useIsPhone";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export default function BookmarkPreviewPage(props: {
  params: Promise<{ bookmarkId: string }>;
}) {
  const params = use(props.params);
  const router = useRouter();

  const [open, setOpen] = useState(true);
  const isPhone = useIsPhone();

  const setOpenWithRouter = (value: boolean) => {
    setOpen(value);
    if (!value) {
      router.back();
    }
  };

  if (isPhone) {
    // Fork: on a phone, the whole screen (PhoneViewer), not a dialog box.
    return (
      <DialogPrimitive.Root open={open} onOpenChange={setOpenWithRouter}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="fixed inset-0 z-50 outline-none duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          >
            <DialogPrimitive.Title className="sr-only">
              Preview
            </DialogPrimitive.Title>
            <BookmarkPreview
              bookmarkId={params.bookmarkId}
              variant="phone"
              onClose={() => setOpenWithRouter(false)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  // Fork: a picture opens at once, as it will stay. Only a quick fade: the
  // dialogs' zoom and slide read as the picture resizing, and scaled a large
  // one badly while it ran. Centred by margins, so the fade moves nothing.
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpenWithRouter}>
      <DialogPrimitive.Portal>
        {/* Darker than other dialogs: a picture or video should sit against
            near-black, not a half-lit feed. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95 duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {/* Sized by its content: BookmarkPreview's "modal" variant wraps a
            picture or video, and gives everything else a 90% box. Unseen for
            the moment a picture's size is still being read
            (MediaFitPreview's data-media-pending). */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-0 z-50 m-auto h-fit w-fit max-w-[90vw] overflow-hidden rounded-xl bg-background shadow-lg outline-none duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 [&:has([data-media-pending])]:invisible"
        >
          <DialogPrimitive.Title className="sr-only">
            Preview
          </DialogPrimitive.Title>
          <BookmarkPreview
            bookmarkId={params.bookmarkId}
            variant="modal"
            onClose={() => setOpenWithRouter(false)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
