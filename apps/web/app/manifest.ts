import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "vrana",
    short_name: "vrana",
    description:
      "The Bookmark Everything app. Hoard links, notes, and images and they will get automatically tagged AI.",
    background_color: "#fbfaf7",
    theme_color: "#fbfaf7",
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
    // Fork: no install screenshots — upstream's showed Karakeep's old look
    // and branding (public/screenshots/ is left as upstream has it).
  };
}
