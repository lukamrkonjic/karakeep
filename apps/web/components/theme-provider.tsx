"use client";

import type { ThemeProviderProps } from "next-themes";
import * as React from "react";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider scriptProps={{ "data-cfasync": "false" }} {...props}>
      {children}
    </NextThemesProvider>
  );
}

/**
 * Fork: the theme is the account's (next-themes keeps a per-browser copy so
 * the page paints in it before React runs). Applies the account's choice when
 * it differs from this browser's — on load, and when it changes.
 */
export function ThemePreferenceSync() {
  const preferred = usePreference("theme");
  const { theme, setTheme } = useTheme();
  const applied = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (preferred && applied.current !== preferred) {
      applied.current = preferred;
      if (theme !== preferred) {
        setTheme(preferred);
      }
    }
  }, [preferred, theme, setTheme]);
  return null;
}

export function useToggleTheme() {
  const { theme, setTheme } = useTheme();
  const updatePreferences = useUpdatePreferences();
  const next = theme == "dark" ? "light" : "dark";
  return () => {
    setTheme(next);
    void updatePreferences({ theme: next });
  };
}
