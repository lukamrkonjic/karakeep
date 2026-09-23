import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { Button } from "@/components/ui/button";
import FilePickerButton from "@/components/ui/file-picker-button";
import { toast } from "@/components/ui/sonner";
import useUpload from "@/lib/hooks/upload-file";
import { useTranslation } from "@/lib/i18n/client";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";

import {
  useAttachBookmarkAsset,
  useDetachBookmarkAsset,
  useReplaceBookmarkAsset,
} from "@karakeep/shared-react/hooks/assets";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import {
  humanFriendlyNameForAssertType,
  isAllowedToAttachAsset,
  isAllowedToDetachAsset,
} from "@karakeep/trpc/lib/attachments";

export default function AttachmentBox({
  bookmark,
  readOnly = false,
  mainAssetId,
}: {
  bookmark: ZBookmark;
  readOnly?: boolean;
  /**
   * Fork: the file the bookmark IS (a picture, video or PDF) — left out: it's
   * not attached to itself, and the panel's Download button has it. Such a
   * bookmark offers no "+ Add file" either (that's for articles and notes),
   * so its section only shows when something else is attached.
   */
  mainAssetId?: string;
}) {
  const { t } = useTranslation();
  const { mutate: attachAsset, isPending: isAttaching } =
    useAttachBookmarkAsset({
      onSuccess: () => {
        toast({
          description: "Attachment has been attached!",
        });
      },
      onError: (e) => {
        toast({
          description: e.message,
          variant: "destructive",
        });
      },
    });

  const { mutate: replaceAsset, isPending: isReplacing } =
    useReplaceBookmarkAsset({
      onSuccess: () => {
        toast({
          description: "Attachment has been replaced!",
        });
      },
      onError: (e) => {
        toast({
          description: e.message,
          variant: "destructive",
        });
      },
    });

  const { mutate: detachAsset, isPending: isDetaching } =
    useDetachBookmarkAsset({
      onSuccess: () => {
        toast({
          description: "Attachment has been detached!",
        });
      },
      onError: (e) => {
        toast({
          description: e.message,
          variant: "destructive",
        });
      },
    });

  const { mutate: uploadAsset } = useUpload({
    onError: (e) => {
      toast({
        description: e.error,
        variant: "destructive",
      });
    },
  });

  // Video thumbnails are generated internally (see assetPreprocessingWorker)
  // and aren't something the user attaches/manages directly.
  const visibleAssets = bookmark.assets
    .filter((a) => a.assetType !== "videoThumbnail" && a.id !== mainAssetId)
    .sort((a, b) => a.assetType.localeCompare(b.assetType));

  const hasAssets = visibleAssets.length > 0;

  // Fork: a plain section like the panel's others (no collapsing, no icons
  // in the heading); adding a file or a banner is a labelled + under the
  // files, like the + under Lists.
  const canAddBanner =
    !bookmark.assets.some((asset) => asset.assetType == "bannerImage") &&
    bookmark.content.type != BookmarkTypes.ASSET;
  const addButton =
    "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  const canAdd = !readOnly && !mainAssetId;
  if (!hasAssets && !canAdd) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-foreground">
        {t("common.attachments")}
      </p>
      <div className="flex flex-col gap-1 text-sm">
        {visibleAssets.map((asset) => (
          <div key={asset.id} className="flex items-center justify-between">
            <Link
              target="_blank"
              href={getAssetUrl(asset.id)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              prefetch={false}
            >
              <p>
                {asset.assetType === "userUploaded" && asset.fileName
                  ? asset.fileName
                  : humanFriendlyNameForAssertType(asset.assetType)}
              </p>
            </Link>
            <div className="flex gap-1 text-muted-foreground">
              <Link
                title="Download"
                target="_blank"
                href={getAssetUrl(asset.id)}
                className="flex items-center gap-1 rounded-md p-1 hover:text-foreground"
                download={
                  asset.assetType === "userUploaded" && asset.fileName
                    ? asset.fileName
                    : humanFriendlyNameForAssertType(asset.assetType)
                }
                prefetch={false}
              >
                <Download className="size-3.5" strokeWidth={1.5} />
              </Link>
              {!readOnly &&
                isAllowedToAttachAsset(asset.assetType) &&
                asset.assetType !== "userUploaded" && (
                  <FilePickerButton
                    title="Replace"
                    loading={isReplacing}
                    accept=".jgp,.JPG,.jpeg,.png,.webp"
                    multiple={false}
                    variant="none"
                    size="none"
                    className="flex items-center gap-2 rounded-md p-1 hover:text-foreground"
                    onFileSelect={(file) =>
                      uploadAsset(file, {
                        onSuccess: (resp) => {
                          replaceAsset({
                            bookmarkId: bookmark.id,
                            oldAssetId: asset.id,
                            newAssetId: resp.assetId,
                          });
                        },
                      })
                    }
                  >
                    <Pencil className="size-3.5" strokeWidth={1.5} />
                  </FilePickerButton>
                )}
              {!readOnly && isAllowedToDetachAsset(asset.assetType) && (
                <ActionConfirmingDialog
                  title="Delete Attachment?"
                  description={`Are you sure you want to delete the attachment of the bookmark?`}
                  actionButton={(setDialogOpen) => (
                    <ActionButton
                      loading={isDetaching}
                      variant="destructive"
                      onClick={() =>
                        detachAsset(
                          { bookmarkId: bookmark.id, assetId: asset.id },
                          { onSettled: () => setDialogOpen(false) },
                        )
                      }
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </ActionButton>
                  )}
                >
                  <Button
                    variant="none"
                    size="none"
                    title="Delete"
                    className="rounded-md p-1 hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.5} />
                  </Button>
                </ActionConfirmingDialog>
              )}
            </div>
          </div>
        ))}
      </div>
      {canAdd && (
        <div className="-ml-2 flex items-center gap-1">
          <FilePickerButton
            title="Attach a file"
            loading={isAttaching}
            multiple={false}
            variant="none"
            size="none"
            className={addButton}
            onFileSelect={(file) =>
              uploadAsset(file, {
                onSuccess: (resp) => {
                  attachAsset({
                    bookmarkId: bookmark.id,
                    asset: {
                      id: resp.assetId,
                      assetType: "userUploaded",
                    },
                  });
                },
              })
            }
          >
            <Plus className="size-3.5" />
            Add file
          </FilePickerButton>
          {canAddBanner && (
            <FilePickerButton
              title="Attach a banner image"
              loading={isAttaching}
              accept=".jpg,.JPG,.jpeg,.png,.webp"
              multiple={false}
              variant="none"
              size="none"
              className={addButton}
              onFileSelect={(file) =>
                uploadAsset(file, {
                  onSuccess: (resp) => {
                    attachAsset({
                      bookmarkId: bookmark.id,
                      asset: {
                        id: resp.assetId,
                        assetType: "bannerImage",
                      },
                    });
                  },
                })
              }
            >
              <Plus className="size-3.5" />
              Add banner
            </FilePickerButton>
          )}
        </div>
      )}
    </div>
  );
}
