"use client";

import type { UserLocalSettings } from "@/lib/userLocalSettings/types";
import React, { useEffect, useState } from "react";
import {
  ThemePreferenceSync,
  ThemeProvider,
} from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Session, SessionProvider } from "@/lib/auth/client";
import { LegacyPreferencesImport } from "@/lib/legacyPreferences";
import { UiPreferencesProvider, usePreference } from "@/lib/uiPreferences";
import { UserLocalSettingsCtx } from "@/lib/userLocalSettings/bookmarksLayout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";

import type { ClientConfig } from "@karakeep/shared/config";
import type { ZUiPreferences } from "@karakeep/shared/types/uiPreferences";
import type { AppRouter } from "@karakeep/trpc/routers/_app";
import { ClientConfigProvider } from "@karakeep/shared-react/providers/client-config-provider";
import {
  TRPC_MAX_URL_LENGTH_INTERNAL,
  TRPCProvider,
} from "@karakeep/shared-react/trpc";

import { i18n } from "./i18n/client";
import CustomI18nextProvider from "./i18n/provider";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important so we don't re-make a new client if React
    // supsends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export default function Providers({
  children,
  session,
  clientConfig,
  userLocalSettings,
  uiPreferences,
}: {
  children: React.ReactNode;
  session: Session | null;
  clientConfig: ClientConfig;
  userLocalSettings: UserLocalSettings;
  uiPreferences: ZUiPreferences;
}) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchLink({
          // TODO: Change this to be a full URL exposed as a client side setting
          url: `/api/trpc`,
          maxURLLength: TRPC_MAX_URL_LENGTH_INTERNAL,
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <ClientConfigProvider value={clientConfig}>
      <UserLocalSettingsCtx.Provider value={userLocalSettings}>
        <SessionProvider session={session}>
          <QueryClientProvider client={queryClient}>
            <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
              <UiPreferencesProvider
                initial={uiPreferences}
                signedIn={session !== null}
              >
                <PreferredLanguage fallback={userLocalSettings.lang}>
                  <ThemeProvider
                    attribute="class"
                    defaultTheme={uiPreferences.theme ?? "system"}
                    enableSystem
                    disableTransitionOnChange
                  >
                    <ThemePreferenceSync />
                    {session && <LegacyPreferencesImport />}
                    <TooltipProvider delayDuration={0}>
                      {children}
                    </TooltipProvider>
                  </ThemeProvider>
                </PreferredLanguage>
              </UiPreferencesProvider>
            </TRPCProvider>
          </QueryClientProvider>
        </SessionProvider>
      </UserLocalSettingsCtx.Provider>
    </ClientConfigProvider>
  );
}

/**
 * Fork: the account's language, the moment it's picked. The switch happens
 * in an effect: i18next tells every translated component at once, which it
 * mustn't do mid-render (CustomI18nextProvider switches during render).
 */
function PreferredLanguage({
  fallback,
  children,
}: {
  fallback: string;
  children: React.ReactNode;
}) {
  const wanted = usePreference("lang") ?? fallback;
  const [lang, setLang] = useState(wanted);
  useEffect(() => {
    if (wanted !== lang) {
      void i18n.changeLanguage(wanted).then(() => setLang(wanted));
    }
  }, [wanted, lang]);
  return <CustomI18nextProvider lang={lang}>{children}</CustomI18nextProvider>;
}
