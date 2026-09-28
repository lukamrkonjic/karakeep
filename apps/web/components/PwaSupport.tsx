"use client";

import { useEffect, useState } from "react";
import { useClientConfig } from "@/lib/clientConfig";
import { THEME_BACKGROUND } from "@/lib/themeColors";
import { usePreference } from "@/lib/uiPreferences";
import { useTheme } from "next-themes";

/**
 * Fork: glue for vrana installed on a phone's home screen or a Mac's Dock.
 * Registers the service worker (public/service-worker.js) in production —
 * https only, which browsers require — once per server version, and paints
 * the browser's bars (theme-color: a phone's status bar, the app's title
 * bar) in the app's own theme, which may not be the device's.
 */
export default function PwaSupport() {
  const { serverVersion } = useClientConfig();
  const preferred = usePreference("theme");
  const { resolvedTheme } = useTheme();
  // This browser's own copy of the theme is known once it runs.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker
      .register(
        `/service-worker.js?v=${encodeURIComponent(serverVersion ?? "dev")}`,
      )
      .catch(() => undefined);
  }, [serverVersion]);

  // Here rather than in the root layout's viewport, whose tags Next
  // replaces on every navigation (each keystroke of a search is one): for a
  // frame there was no colour, and the title bar flashed white. React puts
  // these in the head, and this stays mounted.
  const theme =
    mounted && (resolvedTheme === "light" || resolvedTheme === "dark")
      ? resolvedTheme
      : preferred === "light" || preferred === "dark"
        ? preferred
        : null;
  return theme ? (
    <meta name="theme-color" content={THEME_BACKGROUND[theme]} />
  ) : (
    <>
      <meta
        name="theme-color"
        media="(prefers-color-scheme: light)"
        content={THEME_BACKGROUND.light}
      />
      <meta
        name="theme-color"
        media="(prefers-color-scheme: dark)"
        content={THEME_BACKGROUND.dark}
      />
    </>
  );
}
