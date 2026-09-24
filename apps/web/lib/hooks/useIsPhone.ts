import { useSyncExternalStore } from "react";

// The width the bookmark grid switches to a phone's own columns at (sm).
const PHONE = "(max-width: 640px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Fork: whether the screen is phone-sized — for the few things a phone does
 * differently in code rather than CSS (its own grid columns, the full-screen
 * viewer). False while rendering on the server.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

const TOUCH = "(pointer: coarse)";

function subscribeTouch(onChange: () => void) {
  const query = window.matchMedia(TOUCH);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Fork: whether the main pointer is a finger (phones, tablets). */
export function useIsTouch(): boolean {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH).matches,
    () => false,
  );
}
