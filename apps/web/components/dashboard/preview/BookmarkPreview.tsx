"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookmarkTagsEditor } from "@/components/dashboard/bookmarks/BookmarkTagsEditor";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/client";
import { useIsPhone } from "@/lib/hooks/useIsPhone";
import { useTranslation } from "@/lib/i18n/client";
import {
  usePreviewDetailsHidden,
  useTogglePreviewDetails,
} from "@/lib/previewDetails";
import { useQuery } from "@tanstack/react-query";
import { Globe, PanelRightClose, PanelRightOpen } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  BookmarkTypes,
  ZBookmark,
  ZBookmarkTypeText,
} from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import {
  getBookmarkRefreshInterval,
  getSourceUrl,
  isBookmarkStillCrawling,
} from "@karakeep/shared/utils/bookmarkUtils";

import { BookmarkMarkdownComponent } from "../bookmarks/BookmarkMarkdownComponent";
import SummarizeBookmarkArea from "../bookmarks/SummarizeBookmarkArea";
import { ListSuggestionChips } from "../pictures/ListSuggestionChips";
import { pictureOf } from "../pictures/pictures";
import { SimilarPictures } from "../pictures/SimilarPictures";
import { AssetContentSection } from "./AssetContentSection";
import AttachmentBox from "./AttachmentBox";
import { BookmarkListChips } from "./BookmarkListChips";
import { BookmarkNameInput } from "./BookmarkNameInput";
import { BookmarkProperties } from "./BookmarkProperties";
import HighlightsBox from "./HighlightsBox";
import LinkContentSection from "./LinkContentSection";
import { getPreviewMedia, MediaFitPreview } from "./MediaFitPreview";
import { PhoneViewer } from "./PhoneViewer";
import { NoteEditor } from "./NoteEditor";
import { PreviewActions } from "./PreviewActions";
import { TextContentSection } from "./TextContentSection";

function ContentLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <Globe className="h-12 w-12 animate-bounce text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {t("preview.crawling_in_progress")}
      </p>
    </div>
  );
}

/** "https://www.example.com/a/b/?x" → "example.com/a/b" */
function shortUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname.replace(/^www\./, "")}${pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Fork: what a downloaded file is called — the name you gave the bookmark,
 * with the file's own extension; unnamed, the file's own name.
 */
function downloadName(bookmark: ZBookmark): string | undefined {
  const fileName =
    bookmark.content.type === BookmarkTypes.ASSET
      ? (bookmark.content.fileName ?? undefined)
      : undefined;
  const title = bookmark.title?.trim();
  if (!title) {
    return fileName;
  }
  const extension = fileName?.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "";
  return title.toLowerCase().endsWith(extension.toLowerCase())
    ? title
    : `${title}${extension}`;
}

/**
 * Fork: where the bookmark came from — the page, or where a picture or video
 * was saved from — as a field like Eagle's URL one, opening it in a new tab.
 */
function SourceField({ url }: { url: string }) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="min-w-0 flex-1 truncate">{shortUrl(url)}</span>
      <Globe className="size-4 shrink-0" />
    </Link>
  );
}

export default function BookmarkPreview({
  bookmarkId,
  initialData,
  onClose,
  variant = "page",
}: {
  bookmarkId: string;
  initialData?: ZBookmark;
  onClose?: () => void;
  /** "modal" sizes itself (the dialog wraps it); "page" fills its parent;
   *  "phone" is the full-screen viewer (PhoneViewer). */
  variant?: "page" | "modal" | "phone";
}) {
  const api = useTRPC();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>("content");
  // Fork: a preview opened as a page (a link to it, or a reload) is the
  // phone's full-screen viewer too.
  const isPhone = useIsPhone();
  const router = useRouter();
  if (variant === "page" && isPhone) {
    variant = "phone";
    // A preview is a page only when loaded as one (a link, a reload): what
    // came before may be anywhere, so closing goes Home.
    onClose ??= () => router.replace("/dashboard/bookmarks");
  }
  // Fork: one remembered setting for every preview (lib/previewDetails.ts).
  const sidebarCollapsed = usePreviewDetailsHidden();
  const toggleDetails = useTogglePreviewDetails();
  const { data: session } = useSession();

  const { data: bookmark } = useQuery(
    api.bookmarks.getBookmark.queryOptions(
      {
        bookmarkId,
      },
      {
        initialData,
        refetchInterval: (query) => {
          const data = query.state.data;
          if (!data) {
            return false;
          }
          return getBookmarkRefreshInterval(data);
        },
      },
    ),
  );

  if (!bookmark) {
    if (variant === "phone") {
      return (
        <div className="fixed inset-0 bg-black">
          <FullPageSpinner />
        </div>
      );
    }
    return variant === "modal" ? (
      <div className="h-[50vh] w-[50vw]">
        <FullPageSpinner />
      </div>
    ) : (
      <FullPageSpinner />
    );
  }

  // In the modal, a picture or a video gets a dialog that wraps it.
  const previewMedia = getPreviewMedia(bookmark);
  const media = variant === "modal" ? previewMedia : null;
  const box = variant === "modal" ? "h-[90vh] w-[90vw]" : "h-full w-full";

  // Check if the current user owns this bookmark
  const isOwner = session?.user?.id === bookmark.userId;

  let content;
  switch (bookmark.content.type) {
    case BookmarkTypes.LINK: {
      content = <LinkContentSection bookmark={bookmark} />;
      break;
    }
    case BookmarkTypes.TEXT: {
      content = <TextContentSection bookmark={bookmark} />;
      break;
    }
    case BookmarkTypes.ASSET: {
      content = <AssetContentSection bookmark={bookmark} />;
      break;
    }
  }

  const sourceUrl = getSourceUrl(bookmark);
  // Fork: the file the bookmark is (a picture, video or PDF, or a note's
  // video) — downloaded from the footer rather than listed as an attachment.
  const mainAssetId =
    bookmark.content.type === BookmarkTypes.ASSET
      ? bookmark.content.assetId
      : previewMedia?.assetId;
  const download = mainAssetId
    ? {
        href: getAssetUrl(mainAssetId),
        fileName: downloadName(bookmark),
      }
    : undefined;

  // Common content for both layouts
  const contentSection = isBookmarkStillCrawling(bookmark) ? (
    <ContentLoading />
  ) : (
    content
  );

  // Fork: laid out like Eagle's inspector — the name, description, tags and
  // source as fields, then Lists and Properties; Archive/Delete sit at the
  // bottom of the panel (min-h-full + mt-auto) under a divider.
  const detailsSection = (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <BookmarkNameInput bookmark={bookmark} readOnly={!isOwner} />
        {/* A video note's text, which the media layout has no room for
            beside the video. */}
        {media && bookmark.content.type === BookmarkTypes.TEXT && (
          // Small and muted: it reads as the video's caption.
          <div className="[&_.prose]:text-sm [&_.prose]:text-muted-foreground">
            <BookmarkMarkdownComponent>
              {bookmark as ZBookmarkTypeText}
            </BookmarkMarkdownComponent>
          </div>
        )}
        <NoteEditor
          bookmark={bookmark}
          disabled={!isOwner}
          placeholder="Description..."
        />
        <BookmarkTagsEditor bookmark={bookmark} disabled={!isOwner} />
        {sourceUrl && <SourceField url={sourceUrl} />}
        <SummarizeBookmarkArea bookmark={bookmark} readOnly={!isOwner} />
      </div>
      <div className="flex flex-col gap-2">
        <BookmarkListChips bookmarkId={bookmark.id} readOnly={!isOwner} />
        {/* Fork: lists suggested for a picture, and pictures like it. */}
        {isOwner && <ListSuggestionChips bookmarkId={bookmark.id} />}
      </div>
      <BookmarkProperties
        bookmark={bookmark}
        media={previewMedia}
        readOnly={!isOwner}
      />
      {pictureOf(bookmark) && <SimilarPictures bookmarkId={bookmark.id} />}
      <AttachmentBox
        bookmark={bookmark}
        readOnly={!isOwner}
        mainAssetId={mainAssetId}
      />
      <HighlightsBox bookmarkId={bookmark.id} readOnly={!isOwner} />
      <div className="mt-auto">
        <PreviewActions
          bookmark={bookmark}
          canEdit={isOwner}
          download={download}
        />
      </div>
    </div>
  );

  if (variant === "phone") {
    return (
      <PhoneViewer
        bookmark={bookmark}
        media={previewMedia}
        content={contentSection}
        details={detailsSection}
        sourceUrl={sourceUrl ?? null}
        isOwner={isOwner}
        onClose={onClose ?? (() => undefined)}
      />
    );
  }

  return (
    <>
      {/* Render original layout for wide screens */}
      {media ? (
        <div className="hidden lg:block">
          <MediaFitPreview
            media={media}
            details={detailsSection}
            onClose={onClose}
          />
        </div>
      ) : (
        <div
          className={`hidden ${box} flex-col overflow-hidden bg-background lg:flex`}
        >
          <div className="flex min-h-0 flex-1">
            <div className="relative h-full flex-1 overflow-auto px-4 py-4">
              <button
                onClick={toggleDetails}
                className="absolute right-4 top-4 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {sidebarCollapsed ? (
                  <PanelRightOpen size={20} />
                ) : (
                  <PanelRightClose size={20} />
                )}
              </button>
              {contentSection}
            </div>
            {!sidebarCollapsed && (
              <div className="flex w-1/3 flex-col gap-3 overflow-auto border-l bg-muted/40 p-5">
                {detailsSection}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Render tabbed layout for narrow/vertical screens */}
      <div className={`flex ${box} flex-col overflow-hidden lg:hidden`}>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="z-10 mx-4 mt-2 grid w-auto grid-cols-2">
            <TabsTrigger value="content">
              {t("preview.tabs.content")}
            </TabsTrigger>
            <TabsTrigger value="details">
              {t("preview.tabs.details")}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="content"
            className="h-full flex-1 overflow-hidden overflow-y-auto bg-background px-4 py-3 data-[state=inactive]:hidden"
          >
            {contentSection}
          </TabsContent>
          <TabsContent
            value="details"
            className="h-full overflow-y-auto bg-background px-4 py-3 data-[state=inactive]:hidden"
          >
            {detailsSection}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
