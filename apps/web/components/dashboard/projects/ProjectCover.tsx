import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";

import type { ZProjectCover } from "@karakeep/shared/types/projects";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

function Tile({
  picture,
  className,
}: {
  picture: ZProjectCover;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the server's own file, any size
    <img
      src={getAssetUrl(picture.assetId)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("size-full min-h-0 min-w-0 object-cover", className)}
    />
  );
}

/**
 * Fork: a project's cover, as Pinterest shows a board — its biggest
 * picture large, the next two stacked beside it; fewer fill the space they
 * have. An empty one is a quiet tile.
 */
export function ProjectCover({
  cover,
  className,
}: {
  cover: ZProjectCover[];
  className?: string;
}) {
  const [first, second, third] = cover;
  return (
    <div
      className={cn(
        "grid overflow-hidden bg-muted",
        cover.length >= 2 ? "grid-cols-3 gap-0.5" : "grid-cols-1",
        className,
      )}
    >
      {!first ? (
        <div className="flex items-center justify-center text-muted-foreground/40">
          <LayoutGrid className="size-1/4 max-h-10 max-w-10" strokeWidth={1} />
        </div>
      ) : cover.length === 1 ? (
        <Tile picture={first} />
      ) : (
        <>
          <Tile picture={first} className="col-span-2" />
          <div
            className={cn(
              "grid min-h-0 gap-0.5",
              third ? "grid-rows-2" : "grid-rows-1",
            )}
          >
            <Tile picture={second} />
            {third && <Tile picture={third} />}
          </div>
        </>
      )}
    </div>
  );
}
