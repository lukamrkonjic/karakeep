"use client";

import { useEffect } from "react";
import { useClientConfig } from "@/lib/clientConfig";
import { useTheme } from "next-themes";

// The theme's --background (tooling/tailwind): light 45 33% 97.6%, dark
// 40 7% 9%.
const BACKGROUND = { light: "#fbfaf7", dark: "#191715" };

/**
 * Fork: glue for vrana installed on a phone's home screen. Registers the
 * service worker (public/service-worker.js) in production — https only, which browsers
 * require — once per server version, and paints the status bar (theme-color)
 * in the app's own theme, which may not be the phone's.
 */
export default function PwaSupport() {
  const { serverVersion } = useClientConfig();
  const { resolvedTheme } = useTheme();

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

  useEffect(() => {
    if (!resolvedTheme) {
      return;
    }
    const color = resolvedTheme === "dark" ? BACKGROUND.dark : BACKGROUND.light;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", color);
    }
  }, [resolvedTheme]);

  return null;
}
