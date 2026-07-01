import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { LIST_DRAG_MIME } from "@/lib/list-drag";
import { cn } from "@/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  useBookmarkLists,
  useReorderBookmarkList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { ZBookmarkList } from "@karakeep/shared/types/lists";
import { ZBookmarkListTreeNode } from "@karakeep/shared/utils/listUtils";

type RenderFunc = (params: {
  node: ZBookmarkListTreeNode;
  level: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  numBookmarks?: number;
}) => React.ReactNode;

type IsOpenFunc = (list: ZBookmarkListTreeNode) => boolean;

/**
 * Thin horizontal insertion-line indicator, shown at the exact gap a
 * dragged list would land in. Uses the same accent (bg-primary) as the
 * ring-primary drop highlight used when dragging bookmarks onto a list
 * (see SidebarItem's dropHighlight), so the two drag interactions read as
 * one consistent design language.
 */
function DropIndicatorLine({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-primary",
        position === "top" ? "-top-px" : "-bottom-px",
      )}
    />
  );
}

/**
 * Wraps a list of already-position-sorted siblings (same parent) with
 * drag-and-drop reordering. Only enabled for lists the user owns —
 * reordering a shared list's row would silently reorder it for the owner
 * too, since bookmarkLists.position lives on the same row regardless of who
 * is viewing it.
 */
function ReorderableSiblings({
  nodes,
  reorderable,
  renderNode,
}: {
  nodes: ZBookmarkListTreeNode[];
  reorderable: boolean;
  renderNode: (node: ZBookmarkListTreeNode) => React.ReactNode;
}) {
  const { mutate: reorder } = useReorderBookmarkList();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!reorderable) {
    return (
      <>
        {nodes.map((node) => (
          <div key={node.item.id}>{renderNode(node)}</div>
        ))}
      </>
    );
  }

  const computeIndex = (e: React.DragEvent, rowIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? rowIndex : rowIndex + 1;
  };

  return (
    <>
      {nodes.map((node, i) => (
        <div
          key={node.item.id}
          className="relative"
          draggable
          onDragStart={(e) => {
            // Let the row's own onClick/link navigation keep working for a
            // plain click — only dataTransfer marks this as a list drag.
            e.stopPropagation();
            e.dataTransfer.setData(LIST_DRAG_MIME, node.item.id);
            e.dataTransfer.effectAllowed = "move";
            setDraggingId(node.item.id);

            const pill = document.createElement("div");
            pill.textContent = `${node.item.icon} ${node.item.name}`.trim();
            Object.assign(pill.style, {
              position: "fixed",
              left: "-9999px",
              top: "-9999px",
              padding: "6px 12px",
              borderRadius: "8px",
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontSize: "13px",
              fontFamily: "inherit",
              color: "hsl(var(--foreground))",
              maxWidth: "240px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            });
            document.body.appendChild(pill);
            e.dataTransfer.setDragImage(pill, 0, 0);
            requestAnimationFrame(() => pill.remove());
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setOverIndex(null);
          }}
          onDragOver={(e) => {
            if (draggingId === null) {
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOverIndex(computeIndex(e, i));
          }}
          onDrop={(e) => {
            if (draggingId === null) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            const targetIndex = computeIndex(e, i);
            const draggedIndex = nodes.findIndex(
              (n) => n.item.id === draggingId,
            );
            setOverIndex(null);
            const draggedListId = draggingId;
            setDraggingId(null);
            if (draggedIndex === -1) {
              return;
            }
            const adjustedIndex =
              targetIndex > draggedIndex ? targetIndex - 1 : targetIndex;
            if (adjustedIndex !== draggedIndex) {
              reorder({ listId: draggedListId, index: adjustedIndex });
            }
          }}
        >
          {overIndex === i && <DropIndicatorLine position="top" />}
          {renderNode(node)}
          {i === nodes.length - 1 && overIndex === nodes.length && (
            <DropIndicatorLine position="bottom" />
          )}
        </div>
      ))}
    </>
  );
}

function ListItem({
  node,
  render,
  level,
  className,
  isOpenFunc,
  listStats,
  indentOffset,
  reorderable,
}: {
  node: ZBookmarkListTreeNode;
  render: RenderFunc;
  isOpenFunc: IsOpenFunc;
  listStats?: Map<string, number>;
  level: number;
  indentOffset: number;
  className?: string;
  reorderable: boolean;
}) {
  // Not the most efficient way to do this, but it works for now
  const isAnyChildOpen = (
    node: ZBookmarkListTreeNode,
    isOpenFunc: IsOpenFunc,
  ): boolean => {
    if (isOpenFunc(node)) {
      return true;
    }
    return node.children.some((l) => isAnyChildOpen(l, isOpenFunc));
  };
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen((curr) => curr || isAnyChildOpen(node, isOpenFunc));
  }, [node, isOpenFunc]);

  const sortedChildren = node.children
    .slice()
    .sort((a, b) => b.item.position - a.item.position);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      {render({
        node,
        level: level + indentOffset,
        open,
        onOpenChange: setOpen,
        numBookmarks: listStats?.get(node.item.id),
      })}
      <CollapsibleContent>
        <ReorderableSiblings
          nodes={sortedChildren}
          reorderable={reorderable}
          renderNode={(l) => (
            <ListItem
              isOpenFunc={isOpenFunc}
              node={l}
              render={render}
              level={level + 1}
              indentOffset={indentOffset}
              listStats={listStats}
              className={className}
              reorderable={reorderable}
            />
          )}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CollapsibleBookmarkLists({
  render,
  initialData,
  listsData,
  className,
  isOpenFunc,
  filter,
  indentOffset = 0,
  reorderable = false,
}: {
  initialData?: ZBookmarkList[];
  listsData?: {
    data: ZBookmarkList[];
    root: Record<string, ZBookmarkListTreeNode>;
    allPaths: ZBookmarkList[][];
    getPathById: (id: string) => ZBookmarkList[] | undefined;
  };
  render: RenderFunc;
  isOpenFunc?: IsOpenFunc;
  className?: string;
  filter?: (node: ZBookmarkListTreeNode) => boolean;
  indentOffset?: number;
  /** Enable drag-and-drop reordering among siblings. Owned lists only. */
  reorderable?: boolean;
}) {
  const api = useTRPC();
  // If listsData is provided, use it directly. Otherwise, fetch it.
  let { data: fetchedData } = useBookmarkLists(undefined, {
    initialData: initialData ? { lists: initialData } : undefined,
    enabled: !listsData, // Only fetch if listsData is not provided
  });
  const data = listsData || fetchedData;

  const { data: listStats } = useQuery(
    api.lists.stats.queryOptions(undefined, {
      placeholderData: keepPreviousData,
    }),
  );

  if (!data) {
    return <FullPageSpinner />;
  }

  const rootNodes = Object.values(data.root);
  const filteredRoots = (filter ? rootNodes.filter(filter) : rootNodes)
    .slice()
    .sort((a, b) => b.item.position - a.item.position);

  return (
    <div>
      <ReorderableSiblings
        nodes={filteredRoots}
        reorderable={reorderable}
        renderNode={(node) => (
          <ListItem
            node={node}
            render={render}
            level={0}
            indentOffset={indentOffset}
            className={className}
            listStats={listStats?.stats}
            isOpenFunc={isOpenFunc ?? (() => false)}
            reorderable={reorderable}
          />
        )}
      />
    </div>
  );
}
