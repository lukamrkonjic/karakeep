import { Suspense } from "react";
import ErrorFallback from "@/components/dashboard/ErrorFallback";
import Header from "@/components/dashboard/header/Header";
import DemoModeBanner from "@/components/DemoModeBanner";
import InstagramExpiredBanner from "@/components/InstagramExpiredBanner";
import LoadingSpinner from "@/components/ui/spinner";
import ValidAccountCheck from "@/components/utils/ValidAccountCheck";
import { api } from "@/server/api/client";
import { ErrorBoundary } from "react-error-boundary";

import serverConfig from "@karakeep/shared/config";
import { tryCatch } from "@karakeep/shared/tryCatch";

import SidebarCollapseWrapper from "./SidebarCollapseWrapper";

export default async function SidebarLayout({
  children,
  mobileSidebar,
  sidebar,
  modal,
}: {
  children: React.ReactNode;
  mobileSidebar: React.ReactNode;
  sidebar: React.ReactNode;
  modal?: React.ReactNode;
}) {
  const instagram = await tryCatch(api.instagram.status());
  // Fork: a column, so a strip above the header (Instagram signed out)
  // takes its height from the page below instead of pushing it off.
  return (
    <div className="sm:fixed sm:inset-0 sm:flex sm:flex-col sm:overflow-hidden">
      <InstagramExpiredBanner initialData={instagram.data ?? null} />
      <Header />
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full flex-col sm:min-h-0 sm:flex-1 sm:flex-row sm:overflow-hidden">
        <ValidAccountCheck />
        <SidebarCollapseWrapper>{sidebar}</SidebarCollapseWrapper>
        <main className="flex-1 bg-background sm:min-h-0 sm:overflow-y-auto">
          {serverConfig.demoMode && <DemoModeBanner />}
          {/* Fork: the phone's tab bar (fixed to the bottom). */}
          {mobileSidebar}
          {modal}
          {/* On a phone: a 16px gutter, and room at the bottom so the tab
              bar never covers the last row. */}
          <div className="min-h-30 w-full px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-3 sm:p-5">
            <ErrorBoundary fallback={<ErrorFallback />}>
              <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
