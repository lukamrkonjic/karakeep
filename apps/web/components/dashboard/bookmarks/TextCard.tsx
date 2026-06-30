"use client";

import Image from "next/image";
import Link from "next/link";
import { BookmarkMarkdownComponent } from "@/components/dashboard/bookmarks/BookmarkMarkdownComponent";
import { bookmarkLayoutSwitch } from "@/lib/userLocalSettings/bookmarksLayout";
import { cn } from "@/lib/utils";

import type { ZBookmarkTypeText } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getSourceUrl } from "@karakeep/shared/utils/bookmarkUtils";

import { BookmarkLayoutAdaptingCard } from "./BookmarkLayoutAdaptingCard";
import { BookmarkVideo } from "./BookmarkVideo";
import FooterLinkURL from "./FooterLinkURL";

export default function TextCard({
  bookmark,
  className,
  bookmarkIndex,
}: {
  bookmark: ZBookmarkTypeText;
  className?: string;
  bookmarkIndex?: number;
}) {
  const banner = bookmark.assets.find((a) => a.assetType == "bannerImage");
  const video = bookmark.assets.find((a) => a.assetType == "video");
  return (
    <>
      <BookmarkLayoutAdaptingCard
        title={bookmark.title}
        content={
          <BookmarkMarkdownComponent readOnly={true}>
            {bookmark}
          </BookmarkMarkdownComponent>
        }
        footer={
          getSourceUrl(bookmark) && (
            <FooterLinkURL url={getSourceUrl(bookmark)} />
          )
        }
        wrapTags={true}
        bookmark={bookmark}
        className={className}
        bookmarkIndex={bookmarkIndex}
        fitHeight={true}
        image={(layout, className) => {
          // A video attachment takes priority and renders as an inline,
          // first-frame-thumbnail player in every layout that shows media.
          const videoNode = video ? (
            <BookmarkVideo
              assetId={video.id}
              thumbnail
              className={cn("size-full", className)}
            />
          ) : null;
          return bookmarkLayoutSwitch(layout, {
            grid: videoNode,
            masonry: videoNode,
            compact: null,
            list:
              videoNode ??
              (banner ? (
                <div className="relative size-full flex-1">
                  <Link href={`/dashboard/preview/${bookmark.id}`}>
                    <Image
                      alt="card banner"
                      fill={true}
                      unoptimized
                      className={cn("flex-1", className)}
                      src={getAssetUrl(banner.id)}
                    />
                  </Link>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex size-full items-center justify-center bg-accent text-center",
                    className,
                  )}
                >
                  Note
                </div>
              )),
          });
        }}
      />
    </>
  );
}
