"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { BOOKMARK_DRAG_MIME } from "@/lib/bookmark-drag";
import { useClientConfig } from "@/lib/clientConfig";
import useUpload from "@/lib/hooks/upload-file";
import { cn } from "@/lib/utils";
import { TRPCClientError } from "@trpc/client";
import DropZone from "react-dropzone";

import { useBookmarkListContext } from "@karakeep/shared-react/hooks/bookmark-list-context";
import { useCreateBookmarkWithPostHook } from "@karakeep/shared-react/hooks/bookmarks";
import { useAddBookmarkToList } from "@karakeep/shared-react/hooks/lists";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import LoadingSpinner from "../ui/spinner";
import BookmarkAlreadyExistsToast from "../utils/BookmarkAlreadyExistsToast";

export function useUploadAsset() {
  // When an upload happens while viewing a list, drop the new bookmark into
  // that list (so drag-drop, editor paste, and the global screenshot paste
  // all land where you'd expect). Undefined outside a list page.
  const currentList = useBookmarkListContext();
  const { mutateAsync: addToList } = useAddBookmarkToList();

  const addToCurrentList = useCallback(
    async (bookmark: { id: string; alreadyExists?: boolean }) => {
      if (!currentList || bookmark.alreadyExists) {
        return;
      }
      const canEdit =
        currentList.type === "manual" &&
        (currentList.userRole === "owner" || currentList.userRole === "editor");
      if (!canEdit) {
        return;
      }
      // Best-effort: an "already in list" collision shouldn't surface an error.
      await addToList({
        bookmarkId: bookmark.id,
        listId: currentList.id,
      }).catch(() => undefined);
    },
    [currentList, addToList],
  );

  const { mutateAsync: createBookmark } = useCreateBookmarkWithPostHook({
    onSuccess: (resp) => {
      if (resp.alreadyExists) {
        toast({
          description: <BookmarkAlreadyExistsToast bookmarkId={resp.id} />,
          variant: "default",
        });
      } else {
        toast({ description: "Bookmark uploaded" });
      }
    },
    onError: () => {
      toast({ description: "Something went wrong", variant: "destructive" });
    },
  });

  const { mutateAsync: runUploadAsset } = useUpload({
    onError: (err, req) => {
      toast({
        description: `${req.name}: ${err.error}`,
        variant: "destructive",
      });
    },
  });

  return useCallback(
    async (file: File) => {
      // Handle markdown files as text bookmarks
      if (file.type === "text/markdown" || file.name.endsWith(".md")) {
        try {
          const content = await file.text();
          const bookmark = await createBookmark({
            type: BookmarkTypes.TEXT,
            text: content,
            title: file.name.replace(/\.md$/i, ""), // Remove .md extension from title
            source: "web",
          });
          await addToCurrentList(bookmark);
        } catch {
          toast({
            description: `${file.name}: Failed to read markdown file`,
            variant: "destructive",
          });
        }
        return;
      }
      const uploaded = await runUploadAsset(file);
      const assetType =
        uploaded.contentType === "application/pdf"
          ? "pdf"
          : uploaded.contentType.startsWith("video/")
            ? "video"
            : "image";
      const bookmark = await createBookmark({
        ...uploaded,
        type: BookmarkTypes.ASSET,
        assetType,
        source: "web",
      });
      await addToCurrentList(bookmark);
    },
    [runUploadAsset, createBookmark, addToCurrentList],
  );
}

/**
 * True when a paste event should be left alone for the focused element to
 * handle (a text field, the note editor, etc.) rather than hijacked into a
 * screenshot upload.
 */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
}

/**
 * Extracts image files from a clipboard paste (e.g. a macOS/Windows screenshot
 * snippet), if any.
 */
function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data?.items) {
    return [];
  }
  return Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function useUploadAssets({
  onFileUpload,
  onFileError,
  onAllUploaded,
}: {
  onFileUpload: () => void;
  onFileError: (name: string, e: Error) => void;
  onAllUploaded: () => void;
}) {
  const runUpload = useUploadAsset();

  return async (files: File[]) => {
    if (files.length == 0) {
      return;
    }
    for (const file of files) {
      try {
        await runUpload(file);
        onFileUpload();
      } catch (e) {
        if (e instanceof TRPCClientError || e instanceof Error) {
          onFileError(file.name, e);
        }
      }
    }
    onAllUploaded();
  };
}

export default function UploadDropzone({
  children,
}: {
  children: React.ReactNode;
}) {
  const [numUploading, setNumUploading] = useState(0);
  const [numUploaded, setNumUploaded] = useState(0);
  const uploadAssets = useUploadAssets({
    onFileUpload: () => {
      setNumUploaded((c) => c + 1);
    },
    onFileError: () => {
      setNumUploaded((c) => c + 1);
    },
    onAllUploaded: () => {
      setNumUploading(0);
      setNumUploaded(0);
      return;
    },
  });

  const demoMode = !!useClientConfig().demoMode;

  // uploadAssets gets a fresh identity every render; hold the latest in a ref
  // so the document paste listener registers once.
  const uploadAssetsRef = useRef(uploadAssets);
  uploadAssetsRef.current = uploadAssets;

  // Paste-to-save: take a screenshot snippet (⌘⌃⇧4 on macOS, Win+Shift+S on
  // Windows), then ⌘/Ctrl+V anywhere on a bookmarks/list page to upload it.
  // Because UploadDropzone renders inside the list-context provider on a list
  // page, useUploadAsset drops the result straight into that list.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (demoMode) {
        return;
      }
      // Let text fields / the note editor keep their own paste behaviour.
      if (
        isEditableTarget(e.target) ||
        isEditableTarget(document.activeElement)
      ) {
        return;
      }
      const images = imagesFromClipboard(e.clipboardData);
      if (images.length === 0) {
        return;
      }
      e.preventDefault();
      setNumUploading(images.length);
      void uploadAssetsRef.current(images);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [demoMode]);

  const [isDragging, setDragging] = useState(false);
  const onDrop = (acceptedFiles: File[]) => {
    uploadAssets(acceptedFiles);
    setNumUploading(acceptedFiles.length);
    setDragging(false);
  };

  return (
    <DropZone
      noClick
      onDrop={onDrop}
      onDragEnter={(e) => {
        // Don't show overlay for internal bookmark card drags
        if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME)) {
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
    >
      {({ getRootProps, getInputProps }) => (
        <div {...getRootProps()}>
          <input {...getInputProps()} hidden />
          <div
            className={cn(
              "fixed inset-0 z-50 flex h-full w-full items-center justify-center bg-gray-200 opacity-90",
              isDragging || numUploading > 0 ? undefined : "hidden",
            )}
          >
            {numUploading > 0 ? (
              <div className="flex items-center justify-center gap-2">
                <p className="text-2xl font-bold text-gray-700">
                  Uploading {numUploaded} / {numUploading}
                </p>
                <LoadingSpinner />
              </div>
            ) : (
              <p className="text-2xl font-bold text-gray-700">
                Drop Your Image / Video / PDF / Markdown file
              </p>
            )}
          </div>
          {children}
        </div>
      )}
    </DropZone>
  );
}
