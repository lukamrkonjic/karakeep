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

/**
 * Fork: the account's theme — "system" follows the computer's light or dark
 * mode (macOS, Windows, iOS), as it changes. Settings → User Info.
 */
export function useSetThemePreference() {
  const { setTheme } = useTheme();
  const updatePreferences = useUpdatePreferences();
  return (theme: "light" | "dark" | "system") => {
    setTheme(theme);
    void updatePreferences({ theme }, { immediate: true });
  };
}
