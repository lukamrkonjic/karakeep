"use client";

import Image from "next/image";
import Link from "next/link";
import { useBookmarkLayout } from "@/lib/userLocalSettings/bookmarksLayout";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

import type { ZBookmarkTypeAsset } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getSourceUrl } from "@karakeep/shared/utils/bookmarkUtils";

import { BookmarkLayoutAdaptingCard } from "./BookmarkLayoutAdaptingCard";
import { BookmarkVideo } from "./BookmarkVideo";
import FooterLinkURL from "./FooterLinkURL";
import { MasonryMediaCard } from "./MasonryMediaCard";

function AssetImage({
  bookmark,
  className,
}: {
  bookmark: ZBookmarkTypeAsset;
  className?: string;
}) {
  const bookmarkedAsset = bookmark.content;
  switch (bookmarkedAsset.assetType) {
    case "image": {
      return (
        <Link href={`/dashboard/preview/${bookmark.id}`}>
          <Image
            alt="asset"
            src={getAssetUrl(bookmarkedAsset.assetId)}
            fill={true}
            unoptimized
            className={className}
          />
        </Link>
      );
    }
    case "pdf": {
      const screenshotAssetId = bookmark.assets.find(
        (r) => r.assetType === "assetScreenshot",
      )?.id;
      if (!screenshotAssetId) {
        return (
          <div
            className={cn(className, "flex items-center justify-center")}
            title="PDF screenshot not available. Run asset preprocessing job to generate one screenshot"
          >
            <FileText size={80} />
          </div>
        );
      }
      return (
        <Link href={`/dashboard/preview/${bookmark.id}`}>
          <Image
            alt="asset"
            src={getAssetUrl(screenshotAssetId)}
            fill={true}
            unoptimized
            className={className}
          />
        </Link>
      );
    }
    case "video": {
      const thumbnailAssetId = bookmark.assets.find(
        (r) => r.assetType === "videoThumbnail",
      )?.id;
      return (
        <BookmarkVideo
          assetId={bookmarkedAsset.assetId}
          thumbnailAssetId={thumbnailAssetId}
          thumbnail
          className={cn("size-full", className, "object-contain")}
        />
      );
    }
    default: {
      const _exhaustiveCheck: never = bookmarkedAsset.assetType;
      return <span />;
    }
  }
}

export default function AssetCard({
  bookmark: bookmarkedAsset,
  className,
  bookmarkIndex,
}: {
  bookmark: ZBookmarkTypeAsset;
  className?: string;
  bookmarkIndex?: number;
}) {
  const layout = useBookmarkLayout();
  const contentAssetType = bookmarkedAsset.content.assetType;

  // In masonry, image/video assets render as a clean media-only tile (eagle
  // style) — same as link bookmarks with an attached video (see TextCard).
  if (
    layout === "masonry" &&
    (contentAssetType === "image" || contentAssetType === "video")
  ) {
    const thumbnailAssetId =
      contentAssetType === "video"
        ? bookmarkedAsset.assets.find((r) => r.assetType === "videoThumbnail")
            ?.id
        : undefined;
    return (
      <MasonryMediaCard
        bookmark={bookmarkedAsset}
        media={{
          type: contentAssetType,
          assetId: bookmarkedAsset.content.assetId,
          thumbnailAssetId,
        }}
        className={className}
        bookmarkIndex={bookmarkIndex}
      />
    );
  }

  return (
    <BookmarkLayoutAdaptingCard
      title={bookmarkedAsset.title ?? bookmarkedAsset.content.fileName}
      footer={
        getSourceUrl(bookmarkedAsset) && (
          <FooterLinkURL url={getSourceUrl(bookmarkedAsset)} />
        )
      }
      bookmark={bookmarkedAsset}
      className={className}
      bookmarkIndex={bookmarkIndex}
      wrapTags={true}
      image={(_layout, className) => (
        <div className="relative size-full flex-1">
          <AssetImage bookmark={bookmarkedAsset} className={className} />
        </div>
      )}
    />
  );
}
