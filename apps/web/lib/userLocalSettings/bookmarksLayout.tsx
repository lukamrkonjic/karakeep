"use client";

import type { z } from "zod";
import { createContext, useContext } from "react";
import { fallbackLng } from "@/lib/i18n/settings";
import { usePreference } from "@/lib/uiPreferences";

import type { BookmarksLayoutTypes, zUserLocalSettings } from "./types";

const defaultLayout: BookmarksLayoutTypes = "masonry";

export const UserLocalSettingsCtx = createContext<
  z.infer<typeof zUserLocalSettings>
>({
  bookmarkGridLayout: defaultLayout,
  lang: fallbackLng,
  gridColumns: 3,
  showNotes: false,
  showTags: true,
  showTitle: true,
  imageFit: "cover",
});

function useUserLocalSettings() {
  return useContext(UserLocalSettingsCtx);
}

// Fork: the account's preferences (lib/uiPreferences.tsx) win; this browser's
// cookie (the context) fills in what the account never set.

export function useBookmarkDisplaySettings() {
  const settings = useUserLocalSettings();
  const showNotes = usePreference("showNotes");
  const showTags = usePreference("showTags");
  const showTitle = usePreference("showTitle");
  const imageFit = usePreference("imageFit");
  return {
    showNotes: showNotes ?? settings.showNotes,
    showTags: showTags ?? settings.showTags,
    showTitle: showTitle ?? settings.showTitle,
    imageFit: imageFit ?? settings.imageFit,
  };
}

export function useBookmarkLayout() {
  const settings = useUserLocalSettings();
  return usePreference("bookmarkGridLayout") ?? settings.bookmarkGridLayout;
}

export function useInterfaceLang() {
  const settings = useUserLocalSettings();
  return usePreference("lang") ?? settings.lang;
}

export function useGridColumns() {
  const settings = useUserLocalSettings();
  return usePreference("gridColumns") ?? settings.gridColumns;
}

export function bookmarkLayoutSwitch<T>(
  layout: BookmarksLayoutTypes,
  data: Record<BookmarksLayoutTypes, T>,
) {
  return data[layout];
}

export function useBookmarkLayoutSwitch<T>(
  data: Record<BookmarksLayoutTypes, T>,
) {
  const layout = useBookmarkLayout();
  return data[layout];
}
