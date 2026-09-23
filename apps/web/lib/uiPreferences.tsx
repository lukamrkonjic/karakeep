"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createStore, useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { ZUiPreferences } from "@karakeep/shared/types/uiPreferences";
import { useTRPC } from "@karakeep/shared-react/trpc";

/**
 * Fork: the account's UI preferences in the browser (see
 * packages/shared/types/uiPreferences.ts). Seeded from the server on every
 * page load, so server-rendered pages and the first paint agree. A change
 * applies at once and is saved shortly after — a burst of changes (dragging
 * the columns slider, ticking lists) goes out as one request.
 */

type Patch = Partial<ZUiPreferences>;

interface PreferencesState {
  prefs: ZUiPreferences;
  /**
   * Changes preferences now (a function gets the current ones). Resolves once
   * saved — to false if the save failed — so await it before re-rendering
   * server pages that read them. `immediate` skips the wait.
   */
  update: (
    patch: Patch | ((prefs: ZUiPreferences) => Patch),
    opts?: { immediate?: boolean },
  ) => Promise<boolean>;
}

const SAVE_DELAY_MS = 400;

const PreferencesContext = createContext<StoreApi<PreferencesState> | null>(
  null,
);

// Outside the provider (never in the app): nothing stored, nothing saved.
const detached = createStore<PreferencesState>()(() => ({
  prefs: {},
  update: () => Promise.resolve(true),
}));

export function UiPreferencesProvider({
  initial,
  signedIn,
  children,
}: {
  initial: ZUiPreferences;
  /** Signed out (the sign-in page), changes stay in this page. */
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const api = useTRPC();
  const { mutateAsync } = useMutation(
    api.uiPreferences.update.mutationOptions(),
  );
  const save = useRef(mutateAsync);
  save.current = mutateAsync;
  // Read when saving: signing in can happen without a reload.
  const canSave = useRef(signedIn);
  canSave.current = signedIn;
  // Changes not sent yet, and ones sent but not confirmed: a server copy
  // rendered in between must not undo them.
  const unsaved = useRef<Patch>({});
  const inflight = useRef<Patch>({});
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const [store] = useState(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let waiting: ((saved: boolean) => void)[] = [];
    const flush = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const patch = unsaved.current;
      unsaved.current = {};
      inflight.current = { ...inflight.current, ...patch };
      const done = waiting;
      waiting = [];
      let saved = true;
      try {
        if (canSave.current && Object.keys(patch).length > 0) {
          await save.current(patch);
        }
      } catch {
        // Kept here for this page; the account keeps what it had.
        saved = false;
      }
      for (const key of Object.keys(patch) as (keyof Patch)[]) {
        if (inflight.current[key] === patch[key]) {
          delete inflight.current[key];
        }
      }
      done.forEach((resolve) => resolve(saved));
    };
    flushRef.current = flush;
    return createStore<PreferencesState>()((set, get) => ({
      prefs: initial,
      update: (change, opts) => {
        const patch =
          typeof change === "function" ? change(get().prefs) : change;
        set({ prefs: { ...get().prefs, ...patch } });
        unsaved.current = { ...unsaved.current, ...patch };
        return new Promise<boolean>((resolve) => {
          waiting.push(resolve);
          if (timer) {
            clearTimeout(timer);
          }
          timer = setTimeout(
            () => void flush(),
            opts?.immediate ? 0 : SAVE_DELAY_MS,
          );
        });
      },
    }));
  });

  // The server's copy moves on (another device, a refresh): take it, over
  // anything from here that isn't saved yet.
  const serverCopy = JSON.stringify(initial);
  const lastServerCopy = useRef(serverCopy);
  useEffect(() => {
    if (serverCopy !== lastServerCopy.current) {
      lastServerCopy.current = serverCopy;
      store.setState({
        prefs: { ...initial, ...inflight.current, ...unsaved.current },
      });
    }
  }, [serverCopy, initial, store]);

  // Leaving the page: send what's waiting instead of dropping it.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        void flushRef.current();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  return (
    <PreferencesContext.Provider value={store}>
      {children}
    </PreferencesContext.Provider>
  );
}

/** One preference; `undefined` when never set (use the app's default). */
export function usePreference<K extends keyof ZUiPreferences>(
  key: K,
): ZUiPreferences[K] {
  const store = useContext(PreferencesContext) ?? detached;
  return useStore(store, (s) => s.prefs[key]);
}

/** Every preference, e.g. to see what was never set. */
export function usePreferences(): ZUiPreferences {
  const store = useContext(PreferencesContext) ?? detached;
  return useStore(store, (s) => s.prefs);
}

export function useUpdatePreferences(): PreferencesState["update"] {
  const store = useContext(PreferencesContext) ?? detached;
  return useStore(store, (s) => s.update);
}
