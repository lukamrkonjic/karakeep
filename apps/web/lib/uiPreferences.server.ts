import type { UserLocalSettings } from "@/lib/userLocalSettings/types";
import { cache } from "react";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";

import type { ZUiPreferences } from "@karakeep/shared/types/uiPreferences";

/**
 * Upstream's view options come from a per-browser cookie; the account's
 * values win where it has them.
 */
export function withAccountPreferences(
  local: UserLocalSettings,
  prefs: ZUiPreferences,
): UserLocalSettings {
  return {
    bookmarkGridLayout: prefs.bookmarkGridLayout ?? local.bookmarkGridLayout,
    lang: prefs.lang ?? local.lang,
    gridColumns: prefs.gridColumns ?? local.gridColumns,
    showNotes: prefs.showNotes ?? local.showNotes,
    showTags: prefs.showTags ?? local.showTags,
    showTitle: prefs.showTitle ?? local.showTitle,
    imageFit: prefs.imageFit ?? local.imageFit,
  };
}

/**
 * Fork: the signed-in account's UI preferences, for server components (the
 * root layout seeds the browser's copy; server-rendered grids read their sort
 * from it). Signed out, there are none. Read once per request.
 */
export const getUiPreferences = cache(async (): Promise<ZUiPreferences> => {
  const session = await getServerAuthSession();
  if (!session) {
    return {};
  }
  try {
    return await api.uiPreferences.get();
  } catch {
    return {};
  }
});
