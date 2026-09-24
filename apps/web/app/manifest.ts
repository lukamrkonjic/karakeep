import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Karakeep",
    short_name: "Karakeep",
    description:
      "The Bookmark Everything app. Hoard links, notes, and images and they will get automatically tagged AI.",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    // Fork: the installed app opens on Home (not / and its redirects); the
    // id keeps an app installed from start_url "/" the same app.
    id: "/",
    start_url: "/dashboard/bookmarks",
    scope: "/",
    display: "standalone",
    // Fork: pictures and videos may be turned sideways.
    orientation: "any",
    icons: [
      {
        src: "/icons/logo-16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        src: "/icons/logo-48.png",
        sizes: "48x48",
        type: "image/png",
      },
      {
        src: "/icons/logo-128.png",
        sizes: "128x128",
        type: "image/png",
      },
      {
        src: "/icons/logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Fork: for Android's shaped icons — the mark within the safe zone.
        src: "/icons/logo-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/desktop.png",
        sizes: "3840x2307",
        type: "image/png",
        form_factor: "wide",
        label: "Karakeep desktop bookmark library",
      },
      {
        src: "/screenshots/mobile.png",
        sizes: "692x1498",
        type: "image/png",
        form_factor: "narrow",
        label: "Karakeep mobile bookmark library",
      },
    ],
  };
}
