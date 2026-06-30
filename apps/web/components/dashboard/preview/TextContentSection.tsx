import Image from "next/image";
import { BookmarkMarkdownComponent } from "@/components/dashboard/bookmarks/BookmarkMarkdownComponent";
import { BookmarkVideo } from "@/components/dashboard/bookmarks/BookmarkVideo";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { ZBookmarkTypeText } from "@karakeep/shared/types/bookmarks";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

export function TextContentSection({ bookmark }: { bookmark: ZBookmark }) {
  if (bookmark.content.type != BookmarkTypes.TEXT) {
    throw new Error("Invalid content type");
  }
  const banner = bookmark.assets.find(
    (asset) => asset.assetType == "bannerImage",
  );
  const video = bookmark.assets.find((asset) => asset.assetType == "video");

  return (
    <ScrollArea className="h-full">
      {video && (
        <div className="flex w-full justify-center bg-black">
          <BookmarkVideo
            assetId={video.id}
            className="max-h-[75vh] w-full object-contain"
          />
        </div>
      )}
      {banner && (
        <div className="relative h-52 min-w-full">
          <Image
            alt="banner"
            src={getAssetUrl(banner.id)}
            width={0}
            height={0}
            unoptimized
            layout="fill"
            objectFit="cover"
          />
        </div>
      )}
      <div className="mx-auto max-w-3xl px-4 py-4">
        <BookmarkMarkdownComponent>
          {bookmark as ZBookmarkTypeText}
        </BookmarkMarkdownComponent>
      </div>
    </ScrollArea>
  );
}
