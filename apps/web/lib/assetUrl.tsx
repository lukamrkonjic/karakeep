"use client";

import { createContext, useContext } from "react";

import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

/**
 * Fork: where a file is fetched from — your own (/api/assets/…), or a guest
 * link's (app/share/[token]: its token lets the guest have the files of what
 * they can see). GatedImage and BookmarkVideo ask here, so the guest's grid
 * and preview are the same pictures and players as yours.
 */
const AssetUrlContext = createContext<(assetId: string) => string>(getAssetUrl);

export const AssetUrlProvider = AssetUrlContext.Provider;

export function useAssetUrl() {
  return useContext(AssetUrlContext);
}

export function guestAssetUrl(token: string) {
  return (assetId: string) =>
    `/api/public/shares/${encodeURIComponent(token)}/assets/${assetId}`;
}
