import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import "@karakeep/tailwind-config/globals.css";

import type { Viewport } from "next";
import React from "react";
import PwaSupport from "@/components/PwaSupport";
import Providers from "@/lib/providers";
import {
  getUiPreferences,
  withAccountPreferences,
} from "@/lib/uiPreferences.server";
import { getUserLocalSettings } from "@/lib/userLocalSettings/userLocalSettings";
import { getServerAuthSession } from "@/server/auth";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";

import { clientConfig } from "@karakeep/shared/config";

const inter = Inter({
  subsets: ["latin"],
  fallback: ["sans-serif"],
});

export const metadata: Metadata = {
  title: "vrana",
  applicationName: "vrana",
  description:
    "The Bookmark Everything app. Hoard links, notes, and images and they will get automatically tagged AI.",
  icons: {
    icon: [
      {
        url: "/icons/logo-icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icons/logo-icon-dark.svg",
        type: "image/svg+xml",
        sizes: "any",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    // Fork: the crow for a phone's home screen, at the site root too — where
    // iOS also looks (public/apple-touch-icon.png, as app/apple-icon.png).
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "vrana",
    // Fork: a status bar that is always readable (white text over the
    // light theme's white header would not be); theme-color tints it where
    // iOS follows that.
    statusBarStyle: "default",
  },
  // Fork: Next writes only the standard mobile-web-app-capable; iOS reads
  // Apple's own tag to open the home-screen app full screen when it doesn't
  // take the manifest (a site on plain http).
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  formatDetection: {
    telephone: false,
  },
};

/**
 * Fork: the installed app on a phone — edge to edge (the tab bar keeps clear
 * of the home indicator with env(safe-area-inset-bottom)). The browser's
 * bars (theme-color) aren't here but in PwaSupport: Next replaces these
 * tags on every navigation, and for a frame the bars had no colour — the
 * title bar of vrana in a Mac's Dock flashed white while typing a search.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession();
  // Fork: the account's preferences (UI state that used to be per browser)
  // seed the page, and win over upstream's per-browser view options.
  const uiPreferences = await getUiPreferences();
  const userSettings = withAccountPreferences(
    await getUserLocalSettings(),
    uiPreferences,
  );
  const isRTL = userSettings.lang === "ar";
  return (
    <html
      lang={userSettings.lang}
      dir={isRTL ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <body className={inter.className}>
        <NuqsAdapter>
          <Providers
            session={session}
            clientConfig={clientConfig}
            userLocalSettings={userSettings}
            uiPreferences={uiPreferences}
          >
            {children}
            {/* Fork: in the Mac app (apps/desktop), the top edge of every
                page moves the window, as a title bar would — above the
                header's buttons, and on pages without it (sign-in…). */}
            <div
              aria-hidden
              data-tauri-drag-region
              className="fixed inset-x-0 top-0 z-[60] hidden h-5 mac-app:block"
            />
            <PwaSupport />
            <ReactQueryDevtools initialIsOpen={false} />
          </Providers>
          <Toaster />
        </NuqsAdapter>
      </body>
    </html>
  );
}
