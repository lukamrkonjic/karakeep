"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast as sonner } from "sonner";

import type { ZProjectItem } from "@karakeep/shared/types/projects";
import { useTRPC } from "@karakeep/shared-react/trpc";

/** The board's items, by id. */
export type Items = Readonly<Record<string, ZProjectItem>>;

/** How long after the last change the board saves. */
const SAVE_AFTER_MS = 400;
/** A failed save is tried again after this. */
const RETRY_MS = 5000;
/** The server's copy of something changed here is believed after this. */
const TRUST_SERVER_AFTER_MS = 15_000;
const HISTORY = 100;

export function itemsOf(list: readonly ZProjectItem[]): Items {
  return Object.fromEntries(list.map((i) => [i.id, i]));
}

const sameItem = (a: ZProjectItem, b: ZProjectItem) =>
  a.x === b.x &&
  a.y === b.y &&
  a.w === b.w &&
  a.h === b.h &&
  a.z === b.z &&
  a.text === b.text &&
  a.bookmarkId === b.bookmarkId &&
  a.style?.size === b.style?.size &&
  a.style?.colour === b.style?.colour;

/**
 * Fork: a project board's state (ProjectBoard). The board changes its items
 * here at once and saves them in batches (projects.saveItems) shortly
 * after; what it was before each change is kept so it can be undone (⌘Z)
 * and redone. What the server sends later — pictures added here or from
 * elsewhere, a change on another device — is taken in, except for what's
 * been changed here and isn't saved, or only just was.
 */
export function useBoardState(
  projectId: string,
  serverItems: readonly ZProjectItem[],
  {
    onArrived,
  }: {
    /** Items new from the server that the board asked for (expectArrival). */
    onArrived?: (ids: string[]) => void;
  } = {},
) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Items>(() => itemsOf(serverItems));
  const current = useRef(items);
  const dirty = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  const savedAt = useRef(new Map<string, number>());
  const past = useRef<Items[]>([]);
  const future = useRef<Items[]>([]);
  const expected = useRef(new Set<string>());
  const [, setHistoryVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const onArrivedRef = useRef(onArrived);
  onArrivedRef.current = onArrived;

  const { mutateAsync: saveItems } = useMutation(
    api.projects.saveItems.mutationOptions(),
  );

  const show = useCallback((next: Items) => {
    current.current = next;
    setItems(next);
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) {
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
      return;
    }
    if (dirty.current.size === 0 && removed.current.size === 0) {
      return;
    }
    const now = current.current;
    // A note without words yet isn't saved: it waits here until it has
    // some, or goes (a new note left empty is never kept).
    const unwritten = (id: string) =>
      now[id]?.kind === "note" && !now[id].text?.trim();
    const upsert = [...dirty.current].flatMap((id) =>
      now[id] && !unwritten(id) ? [now[id]] : [],
    );
    const remove = [...removed.current];
    dirty.current = new Set([...dirty.current].filter(unwritten));
    removed.current.clear();
    if (upsert.length === 0 && remove.length === 0) {
      return;
    }
    saving.current = true;
    try {
      await saveItems({ projectId, upsert, remove });
      const at = Date.now();
      for (const id of [...upsert.map((i) => i.id), ...remove]) {
        savedAt.current.set(id, at);
      }
      // The board as saved is what it opens with next time (until the
      // server's own copy comes): this batch, on top of what was there.
      queryClient.setQueryData(
        api.projects.get.queryKey({ projectId }),
        (old) => {
          if (!old) {
            return old;
          }
          const saved = new Map(old.items.map((i) => [i.id, i]));
          remove.forEach((id) => saved.delete(id));
          upsert.forEach((i) => saved.set(i.id, i));
          return { ...old, items: [...saved.values()] };
        },
      );
      void queryClient.invalidateQueries(api.projects.list.pathFilter());
    } catch (e) {
      // Kept for the next try, unless changed again meanwhile.
      for (const item of upsert) {
        if (!removed.current.has(item.id)) {
          dirty.current.add(item.id);
        }
      }
      for (const id of remove) {
        if (!dirty.current.has(id)) {
          removed.current.add(id);
        }
      }
      sonner.error("The board couldn't be saved — trying again", {
        id: `board-save-${projectId}`,
        description: e instanceof Error ? e.message : undefined,
      });
      timer.current = setTimeout(() => void flush(), RETRY_MS);
    } finally {
      saving.current = false;
    }
  }, [api, projectId, queryClient, saveItems]);

  const schedule = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [flush]);

  /** What changed from one state to the next, to be saved. */
  const markChanges = useCallback((from: Items, to: Items) => {
    for (const id of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (!to[id]) {
        dirty.current.delete(id);
        removed.current.add(id);
      } else if (from[id] !== to[id]) {
        removed.current.delete(id);
        dirty.current.add(id);
      }
    }
  }, []);

  /**
   * A change, to be saved and undoable. `from` is the state it was made
   * from when that isn't what's shown (a drag shown as it went).
   */
  const commit = useCallback(
    (next: Items | ((items: Items) => Items), from?: Items) => {
      const before = from ?? current.current;
      const value = typeof next === "function" ? next(current.current) : next;
      if (value === before) {
        show(value);
        return;
      }
      past.current.push(before);
      if (past.current.length > HISTORY) {
        past.current.shift();
      }
      future.current = [];
      markChanges(before, value);
      show(value);
      schedule();
      setHistoryVersion((v) => v + 1);
    },
    [markChanges, schedule, show],
  );

  /** Shown, not saved or kept: a drag as it goes. */
  const preview = useCallback((next: Items) => show(next), [show]);

  /** Saved, but not worth an undo: a picture taking its real shape. */
  const adjust = useCallback(
    (next: (items: Items) => Items) => {
      const before = current.current;
      const value = next(before);
      if (value === before) {
        return;
      }
      markChanges(before, value);
      show(value);
      schedule();
    },
    [markChanges, schedule, show],
  );

  const travel = useCallback(
    (from: Items[], to: Items[]) => {
      const target = from.pop();
      if (!target) {
        return;
      }
      to.push(current.current);
      markChanges(current.current, target);
      show(target);
      schedule();
      setHistoryVersion((v) => v + 1);
    },
    [markChanges, schedule, show],
  );
  const undo = useCallback(
    () => travel(past.current, future.current),
    [travel],
  );
  const redo = useCallback(
    () => travel(future.current, past.current),
    [travel],
  );

  /** These items are on their way from the server (addBookmarks). */
  const expectArrival = useCallback((ids: string[]) => {
    ids.forEach((id) => expected.current.add(id));
  }, []);

  // The server's items, taken in.
  useEffect(() => {
    const now = current.current;
    const fresh = itemsOf(serverItems);
    const recent = (id: string) =>
      Date.now() - (savedAt.current.get(id) ?? 0) < TRUST_SERVER_AFTER_MS;
    const mine = (id: string) =>
      dirty.current.has(id) || removed.current.has(id) || recent(id);
    const next: Record<string, ZProjectItem> = {};
    let changed = false;
    for (const [id, item] of Object.entries(fresh)) {
      if (mine(id)) {
        if (now[id]) {
          next[id] = now[id];
        } else if (!removed.current.has(id) && !recent(id)) {
          next[id] = item;
        }
        continue;
      }
      next[id] = now[id] && sameItem(now[id], item) ? now[id] : item;
      changed ||= next[id] !== now[id];
    }
    for (const [id, item] of Object.entries(now)) {
      if (!fresh[id]) {
        if (mine(id)) {
          next[id] = item;
        } else {
          changed = true;
        }
      }
    }
    if (!changed && Object.keys(next).length === Object.keys(now).length) {
      return;
    }
    const arrived = [...expected.current].filter((id) => next[id] && !now[id]);
    if (arrived.length > 0) {
      // Adding them can be undone like any other change.
      past.current.push(now);
      future.current = [];
      arrived.forEach((id) => expected.current.delete(id));
      setHistoryVersion((v) => v + 1);
    }
    show(next);
    if (arrived.length > 0) {
      onArrivedRef.current?.(arrived);
    }
  }, [serverItems, show]);

  // Saved before the page goes away, or out of sight.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  return {
    items,
    /** The latest items, for handlers that outlive a render. */
    current,
    commit,
    preview,
    adjust,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    expectArrival,
    flush,
  };
}
