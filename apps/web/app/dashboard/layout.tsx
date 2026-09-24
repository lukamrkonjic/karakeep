import { redirect } from "next/navigation";
import { BookmarkPageOptions } from "@/components/dashboard/PageOptions";
import AllLists from "@/components/dashboard/sidebar/AllLists";
import MobileTabBar from "@/components/shared/mobile/MobileTabBar";
import Sidebar from "@/components/shared/sidebar/Sidebar";
import SidebarLayout from "@/components/shared/sidebar/SidebarLayout";
import { ReaderSettingsProvider } from "@/lib/readerSettings";
import { UserSettingsContextProvider } from "@/lib/userSettings";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";
import { TRPCError } from "@trpc/server";
import { TFunction } from "i18next";
import { Archive } from "lucide-react";

import { tryCatch } from "@karakeep/shared/tryCatch";

export default async function Dashboard({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  const [lists, userSettings] = await Promise.all([
    tryCatch(api.lists.list()),
    tryCatch(api.users.settings()),
  ]);

  if (userSettings.error) {
    if (userSettings.error instanceof TRPCError) {
      if (
        userSettings.error.code === "NOT_FOUND" ||
        userSettings.error.code === "UNAUTHORIZED"
      ) {
        redirect("/logout");
      }
    }
    throw userSettings.error;
  }

  if (lists.error) {
    throw lists.error;
  }

  const archive = (t: TFunction) => ({
    name: t("common.archive"),
    icon: <Archive size={18} />,
    path: "/dashboard/archive",
  });

  return (
    <UserSettingsContextProvider userSettings={userSettings.data}>
      <ReaderSettingsProvider>
        <SidebarLayout
          sidebar={
            // Desktop: the lists lead, under Home (also the header logo).
            // Search is the header bar, Highlights is in the profile menu,
            // and Archive sits below the lists.
            <Sidebar
              extraSections={<AllLists initialData={lists.data} />}
              footerItems={(t) => [
                {
                  ...archive(t),
                  right: (
                    <BookmarkPageOptions
                      variant="sidebar"
                      label="Archive options"
                      pageKey="archive"
                      path="/dashboard/archive"
                    />
                  ),
                },
              ]}
            />
          }
          // Fork: on a phone, a tab bar (Home, Feed, Lists, Search, More).
          mobileSidebar={<MobileTabBar lists={lists.data} />}
          modal={modal}
        >
          {children}
        </SidebarLayout>
      </ReaderSettingsProvider>
    </UserSettingsContextProvider>
  );
}
