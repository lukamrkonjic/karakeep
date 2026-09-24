import { Suspense } from "react";
import ErrorFallback from "@/components/dashboard/ErrorFallback";
import Header from "@/components/dashboard/header/Header";
import DemoModeBanner from "@/components/DemoModeBanner";
import InstagramExpiredBanner from "@/components/InstagramExpiredBanner";
import { Separator } from "@/components/ui/separator";
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
      <div className="flex min-h-[calc(100vh-80px)] w-full flex-col sm:min-h-0 sm:flex-1 sm:flex-row sm:overflow-hidden">
        <ValidAccountCheck />
        <SidebarCollapseWrapper>{sidebar}</SidebarCollapseWrapper>
        <main className="flex-1 bg-background sm:min-h-0 sm:overflow-y-auto">
          {serverConfig.demoMode && <DemoModeBanner />}
          <div className="block w-full sm:hidden">
            {mobileSidebar}
            <Separator />
          </div>
          {modal}
          <div className="min-h-30 w-full p-5">
            <ErrorBoundary fallback={<ErrorFallback />}>
              <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
