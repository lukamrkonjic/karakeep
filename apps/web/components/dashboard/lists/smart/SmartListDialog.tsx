"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import LoadingSpinner from "@/components/ui/spinner";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Smile, X } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import type { ZSmartListRules } from "@karakeep/shared/types/smartLists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  compileSmartRules,
  newSmartRuleGroup,
  suggestSmartListName,
} from "@karakeep/shared/smartListRules";

import type { EditorGroup } from "./SmartRulesEditor";
import {
  fromEditorGroups,
  SmartRulesEditor,
  toEditorGroups,
} from "./SmartRulesEditor";

/**
 * Fork: a new smart list, or one to change, the way Eagle makes a smart
 * folder: a name, then rules (SmartRulesEditor), and how many bookmarks
 * they find as they're edited. The sidebar's Smart lists "+", a smart list's
 * "…" → Edit (and "New nested smart list") and the search bar's Save open it.
 */

/**
 * How long a smart list's rules, once read, are taken as they are. Its "…"
 * menu reads them as it opens (PrefetchSmartListRules), so Edit opens with
 * them in place, at its final size; saving them reads them again.
 */
const RULES_FRESH = { staleTime: 30_000, gcTime: 30_000 };

/** Rendered in a smart list's "…" menu: reads its rules as it opens. */
export function PrefetchSmartListRules({ listId }: { listId: string }) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.prefetchQuery(
      api.smartLists.rules.queryOptions({ listId }, RULES_FRESH),
    );
  }, [api, queryClient, listId]);
  return null;
}

/** Its title and what it is — there while its rules load too. */
function SmartListHeader({ editing }: { editing: boolean }) {
  return (
    <DialogHeader className="px-6 pb-4 pt-6">
      <DialogTitle>
        {editing ? "Edit smart list" : "New smart list"}
      </DialogTitle>
      <DialogDescription>
        A smart list collects everything that meets its rules, and keeps itself
        up to date.
      </DialogDescription>
    </DialogHeader>
  );
}

/**
 * While its rules load: unseen for a moment (they're usually there by then,
 * and the dialog opens as it will stay), then a spinner.
 */
function RulesLoading() {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      className="flex h-40 items-center justify-center"
      data-smart-pending={waited ? undefined : ""}
    >
      <LoadingSpinner />
    </div>
  );
}

function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  return (
    <div className="flex items-stretch gap-1">
      <Popover>
        <PopoverTrigger
          className="flex h-10 w-12 items-center justify-center rounded-md bg-muted text-2xl"
          title="Pick an icon"
          aria-label="Pick an icon"
        >
          {value || <Smile className="size-5 text-muted-foreground" />}
        </PopoverTrigger>
        <PopoverContent className="w-auto">
          <Picker
            data={data}
            onEmojiSelect={(e: { native: string }) => onChange(e.native)}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="none"
          className="rounded px-1"
          title="Remove icon"
          aria-label="Remove icon"
          onClick={() => onChange("")}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

/** "Found 128 items", as the rules are edited. */
function FoundCount({ rules }: { rules: ZSmartListRules }) {
  const api = useTRPC();
  // One request once the typing stops, not one a keystroke.
  const key = useDebounce(JSON.stringify(rules), 400);
  const settled = useMemo(() => JSON.parse(key) as ZSmartListRules, [key]);
  const ready = useMemo(
    () => compileSmartRules(settled).matcher !== null,
    [settled],
  );
  const { data, isFetching } = useQuery(
    api.smartLists.preview.queryOptions(
      { rules: settled },
      {
        enabled: ready,
        placeholderData: keepPreviousData,
        // A new "Picture shows": asked again until the pictures are read.
        refetchInterval: (query) =>
          query.state.data?.preparing ? 2000 : false,
      },
    ),
  );
  if (!ready) {
    return (
      <span className="text-muted-foreground">
        Fill in a rule to see what it finds
      </span>
    );
  }
  if (!data) {
    return <span className="text-muted-foreground">Looking…</span>;
  }
  const found = `${data.count.toLocaleString()} ${data.count === 1 ? "item" : "items"}`;
  return (
    <span className={isFetching ? "opacity-60 transition-opacity" : undefined}>
      {data.preparing
        ? `Found ${found} so far — looking in the pictures…`
        : `Found ${found}`}
    </span>
  );
}

function SmartListForm({
  list,
  parentId,
  initialRules,
  onDone,
}: {
  list?: ZBookmarkList;
  parentId?: string | null;
  initialRules?: ZSmartListRules;
  onDone: () => void;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(list?.name ?? "");
  const [icon, setIcon] = useState(list?.icon ?? "");
  const [groups, setGroups] = useState<EditorGroup[]>(() =>
    toEditorGroups(initialRules ?? { groups: [newSmartRuleGroup()] }),
  );
  const rules = useMemo(() => fromEditorGroups(groups), [groups]);
  const compiled = useMemo(() => compileSmartRules(rules), [rules]);

  const { data: lists } = useBookmarkLists();
  const suggested = suggestSmartListName(rules, {
    listName: (id) => lists?.data.find((l) => l.id === id)?.name,
  });
  const finalName = name.trim() || suggested;
  const complete =
    compiled.matcher !== null && compiled.incomplete.length === 0;

  const refresh = (listId: string) => {
    void queryClient.invalidateQueries(api.lists.list.pathFilter());
    void queryClient.invalidateQueries(api.lists.stats.pathFilter());
    void queryClient.invalidateQueries(api.lists.get.queryFilter({ listId }));
    void queryClient.invalidateQueries(
      api.smartLists.rules.queryFilter({ listId }),
    );
    void queryClient.invalidateQueries(
      api.bookmarks.getBookmarks.queryFilter({ listId }),
    );
    void queryClient.invalidateQueries(
      api.bookmarks.getBookmarks.infiniteQueryFilter({ listId }),
    );
  };
  const onError = (e: { message: string }) =>
    toast({ variant: "destructive", description: e.message });
  const create = useMutation(
    api.smartLists.create.mutationOptions({
      onSuccess: (created) => {
        refresh(created.id);
        toast({ description: "Smart list created" });
        onDone();
        router.push(`/dashboard/lists/${created.id}`);
      },
      onError,
    }),
  );
  const update = useMutation(
    api.smartLists.update.mutationOptions({
      onSuccess: (saved) => {
        refresh(saved.id);
        toast({ description: "Smart list saved" });
        onDone();
      },
      onError,
    }),
  );

  const save = () => {
    if (!complete || !finalName) {
      return;
    }
    if (list) {
      update.mutate({ listId: list.id, name: finalName, icon, rules });
    } else {
      create.mutate({ name: finalName, icon, parentId, rules });
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <SmartListHeader editing={!!list} />
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pb-2">
        <div className="flex items-center gap-2">
          <IconPicker value={icon} onChange={setIcon} />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggested || "Smart list name"}
            aria-label="Smart list name"
            maxLength={100}
            autoFocus={!list}
          />
        </div>
        <SmartRulesEditor
          groups={groups}
          onChange={setGroups}
          excludeListId={list?.id}
        />
      </div>
      <DialogFooter className="flex-col items-stretch gap-3 px-6 pb-6 pt-5 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
        <p className="min-w-0 flex-1 text-sm sm:truncate" aria-live="polite">
          <FoundCount rules={rules} />
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <ActionButton
            type="submit"
            loading={create.isPending || update.isPending}
            disabled={!complete || !finalName}
            title={
              !complete
                ? "Fill in every rule"
                : !finalName
                  ? "Give it a name"
                  : undefined
            }
          >
            {list ? "Save" : "Create"}
          </ActionButton>
        </div>
      </DialogFooter>
    </form>
  );
}

/** An existing smart list's rules, then the form. */
function EditSmartList({
  list,
  onDone,
}: {
  list: ZBookmarkList;
  onDone: () => void;
}) {
  const api = useTRPC();
  const { data, error, isFetching } = useQuery(
    api.smartLists.rules.queryOptions({ listId: list.id }, RULES_FRESH),
  );
  // The rules as they are as it opens (read as its menu opened, or now; a
  // read under way is waited for). From then on the form keeps its own.
  const [initialRules, setInitialRules] = useState<ZSmartListRules | null>(
    null,
  );
  if (!initialRules && data && !isFetching && !error) {
    setInitialRules(data.rules);
  }
  if (!initialRules) {
    return (
      <>
        <SmartListHeader editing />
        {error ? (
          <p className="px-6 pb-6 text-sm text-destructive">
            Couldn&apos;t read this smart list&apos;s rules: {error.message}
          </p>
        ) : (
          <RulesLoading />
        )}
      </>
    );
  }
  return (
    <SmartListForm list={list} initialRules={initialRules} onDone={onDone} />
  );
}

export function SmartListDialog({
  open: controlledOpen,
  setOpen: setControlledOpen,
  list,
  parentId,
  rules,
  children,
}: {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  /** The smart list to change; none for a new one. */
  list?: ZBookmarkList;
  /** A new one nested under this list. */
  parentId?: string | null;
  /** A new one's rules to start from (a search saved as a smart list). */
  rules?: ZSmartListRules;
  /** What opens it (the + in the sidebar). */
  children?: React.ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = setControlledOpen ?? setOwnOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      {/* Unseen while its rules are about to arrive (RulesLoading). */}
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 p-0 outline-none sm:max-w-3xl [&:has([data-smart-pending])]:invisible"
        // Editing, nothing is picked out as it opens (its first control
        // wore a focus ring): the dialog itself has the focus.
        onOpenAutoFocus={(e) => {
          if (list) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }
        }}
      >
        {/* Mounted while open: every opening starts from the list as it is. */}
        {list ? (
          <EditSmartList list={list} onDone={() => setOpen(false)} />
        ) : (
          <SmartListForm
            parentId={parentId}
            initialRules={rules}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
