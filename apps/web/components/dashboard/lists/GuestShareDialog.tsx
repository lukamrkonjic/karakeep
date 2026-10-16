"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ActionConfirmingDialog from "@/components/ui/action-confirming-dialog";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { CopyBtnV2 } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useClientConfig } from "@/lib/clientConfig";
import { useGuestShareStore } from "@/lib/store/useGuestShareStore";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";

import type { ZGuestShare } from "@karakeep/shared/types/guestShares";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { MAX_GUEST_SHARE_NAME_LENGTH } from "@karakeep/shared/types/guestShares";

import {
  ChooseListsBody,
  listCandidates,
  useIncludedTicks,
} from "./ChooseListsDialog";

/** How long ticking waits for more ticks before saving them all at once. */
const SAVE_DELAY_MS = 400;

export function guestShareUrl(publicUrl: string, token: string) {
  return `${publicUrl}/share/${token}`;
}

/**
 * The guest link that shows this bookmark — the first whose lists it's in —
 * opening on it (`?p=`): a bookmark's "Copy guest link". Fetched only while
 * `enabled` (its menu is open); undefined until known, null when none does.
 */
export function useGuestLinkFor(bookmarkId: string, enabled: boolean) {
  const api = useTRPC();
  const { publicUrl } = useClientConfig();
  const { data: shares } = useQuery(
    api.guestShares.list.queryOptions(undefined, { enabled }),
  );
  const { data: lists } = useQuery(
    api.lists.getListsOfBookmark.queryOptions({ bookmarkId }, { enabled }),
  );
  if (!shares || !lists) {
    return undefined;
  }
  const inLists = new Set(lists.lists.map((l) => l.id));
  const share = shares.find((s) => s.listIds.some((id) => inLists.has(id)));
  return share
    ? {
        name: share.name,
        url: `${guestShareUrl(publicUrl, share.token)}?p=${bookmarkId}`,
      }
    : null;
}

/**
 * Fork: Share with a guest… — links for someone without an account (your
 * wife, a friend) to look through the lists you tick: the pictures, search,
 * videos, the preview, nothing they can change (app/share/[token]). One link
 * or several, each its own lists; ticks save as they're made. Opened from the
 * profile menu, the phone's More, or a list's "…" — which puts that list in
 * the link (a new one, if there's none yet). Mounted once (dashboard layout),
 * opened through useGuestShareStore.
 */
export function GuestShareDialog() {
  const { open, listId, setOpen } = useGuestShareStore();
  const api = useTRPC();
  const queryClient = useQueryClient();
  const sharesQuery = api.guestShares.list.queryOptions();
  const { data: shares } = useQuery({ ...sharesQuery, enabled: open });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const putShare = (share: ZGuestShare) =>
    queryClient.setQueryData(sharesQuery.queryKey, (old) =>
      old?.some((s) => s.id === share.id)
        ? old.map((s) => (s.id === share.id ? share : s))
        : [share, ...(old ?? [])],
    );

  const { mutate: create, isPending: creating } = useMutation(
    api.guestShares.create.mutationOptions({
      onSuccess: (share) => {
        putShare(share);
        setSelectedId(share.id);
      },
      onError: (e) => toast({ description: e.message, variant: "destructive" }),
    }),
  );

  const selected =
    shares?.find((s) => s.id === selectedId) ?? shares?.[0] ?? null;

  // From a list's "…": that list goes into the link, or into a new one.
  const { data: lists } = useBookmarkLists(undefined, { enabled: open });
  const candidates = useMemo(() => listCandidates(lists?.data ?? []), [lists]);
  const handled = useRef<string | null>(null);
  const update = useMutation(api.guestShares.update.mutationOptions());
  useEffect(() => {
    if (!open) {
      handled.current = null;
      return;
    }
    if (!listId || !shares || handled.current === listId) {
      return;
    }
    handled.current = listId;
    const name = lists?.data.find((l) => l.id === listId)?.name ?? "The list";
    const first = shares[0];
    if (!first) {
      create({ listIds: [listId] });
    } else if (!first.listIds.includes(listId)) {
      update.mutate(
        { id: first.id, listIds: [...first.listIds, listId] },
        {
          onSuccess: (share) => {
            putShare(share);
            toast({ description: `${name} is in “${share.name}” now.` });
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listId, shares]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Share with a guest</DialogTitle>
          <DialogDescription>
            Whoever has the link can look through the lists you tick — search,
            play videos, open pictures — without an account, and can&apos;t
            change anything.
          </DialogDescription>
        </DialogHeader>
        {!shares ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : !selected ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">No guest links yet.</p>
            <ActionButton loading={creating} onClick={() => create({})}>
              Create a link
            </ActionButton>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {shares.length > 1 &&
                shares.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      "max-w-40 truncate rounded-full border px-3 py-1 text-sm transition-colors",
                      s.id === selected.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-muted-foreground"
                disabled={creating}
                onClick={() =>
                  create({ name: `Guest link ${shares.length + 1}` })
                }
              >
                <Plus className="size-4" />
                New link
              </Button>
            </div>
            <GuestShareEditor
              key={selected.id}
              share={selected}
              putShare={putShare}
              onDeleted={() => {
                queryClient.setQueryData(sharesQuery.queryKey, (old) =>
                  old?.filter((s) => s.id !== selected.id),
                );
                setSelectedId(null);
              }}
              candidates={candidates}
              enabled={open}
            />
          </>
        )}
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuestShareEditor({
  share,
  putShare,
  onDeleted,
  candidates,
  enabled,
}: {
  share: ZGuestShare;
  putShare: (share: ZGuestShare) => void;
  onDeleted: () => void;
  candidates: ReturnType<typeof listCandidates>;
  enabled: boolean;
}) {
  const api = useTRPC();
  const clientConfig = useClientConfig();
  const url = guestShareUrl(clientConfig.publicUrl, share.token);
  const onError = (e: { message: string }) =>
    toast({ description: e.message, variant: "destructive" });
  const { mutate: update } = useMutation(
    api.guestShares.update.mutationOptions({ onSuccess: putShare, onError }),
  );
  const { mutate: resetLink, isPending: resetting } = useMutation(
    api.guestShares.resetLink.mutationOptions({
      onSuccess: (s) => {
        putShare(s);
        toast({ description: "A new link — the old one no longer works." });
      },
      onError,
    }),
  );
  const { mutate: remove, isPending: deleting } = useMutation(
    api.guestShares.delete.mutationOptions({ onSuccess: onDeleted, onError }),
  );

  // Ticks show at once and save a moment later, all together.
  const [listIds, setListIds] = useState(share.listIds);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<string[] | null>(null);
  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (waiting.current) {
      update({ id: share.id, listIds: waiting.current });
      waiting.current = null;
    }
  };
  // Closing (or switching links) sends what's waiting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => flush, []);
  const ticks = useIncludedTicks(candidates, listIds, (next) => {
    setListIds(next);
    waiting.current = next;
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  });
  // Put in from elsewhere (a list's "…") while open.
  const serverIds = share.listIds.join(",");
  useEffect(() => {
    if (!waiting.current) {
      setListIds(share.listIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIds]);

  const [name, setName] = useState(share.name);
  const saveName = () => {
    const next = name.trim();
    if (next && next !== share.name) {
      update({ id: share.id, name: next });
    } else {
      setName(share.name);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="guest-share-url" className="text-sm font-medium">
          Link
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="guest-share-url"
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 text-sm"
          />
          <CopyBtnV2 getStringToCopy={() => url} />
          <Button variant="ghost" size="icon" asChild title="Open as a guest">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="guest-share-name" className="w-12 shrink-0 text-sm">
          Name
        </Label>
        <Input
          id="guest-share-name"
          value={name}
          maxLength={MAX_GUEST_SHARE_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="h-8 flex-1 text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="guest-share-notes" className="text-sm font-medium">
            Show my notes
          </Label>
          <p className="text-xs text-muted-foreground">
            The notes you&apos;ve written on bookmarks. Otherwise only you see
            them.
          </p>
        </div>
        <Switch
          id="guest-share-notes"
          checked={share.showNotes}
          onCheckedChange={(showNotes) => update({ id: share.id, showNotes })}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
        <Label className="text-sm font-medium">Lists the guest sees</Label>
        <div className="flex max-h-[40vh] min-h-0 flex-col gap-2">
          <ChooseListsBody ticks={ticks} enabled={enabled} />
        </div>
      </div>
      <div className="flex gap-1 border-t pt-3">
        <ActionConfirmingDialog
          title="Reset this link?"
          description={
            <p className="text-sm">
              It gets a new address, and the old one stops working — for anyone
              you&apos;ve sent it to.
            </p>
          }
          actionButton={(setDialogOpen) => (
            <ActionButton
              loading={resetting}
              onClick={() =>
                resetLink(
                  { id: share.id },
                  { onSettled: () => setDialogOpen(false) },
                )
              }
            >
              Reset link
            </ActionButton>
          )}
        >
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            Reset link
          </Button>
        </ActionConfirmingDialog>
        <ActionConfirmingDialog
          title={`Delete “${share.name}”?`}
          description={
            <p className="text-sm">
              Whoever has it can&apos;t open it any more. Your lists stay as
              they are.
            </p>
          }
          actionButton={(setDialogOpen) => (
            <ActionButton
              variant="destructive"
              loading={deleting}
              onClick={() =>
                remove(
                  { id: share.id },
                  { onSettled: () => setDialogOpen(false) },
                )
              }
            >
              Delete
            </ActionButton>
          )}
        >
          <Button variant="ghost" size="sm" className="text-destructive">
            Delete link
          </Button>
        </ActionConfirmingDialog>
      </div>
    </div>
  );
}
