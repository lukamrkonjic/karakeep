import { redirect } from "next/navigation";
import { BookmarkPageOptions } from "@/components/dashboard/PageOptions";
import AllLists from "@/components/dashboard/sidebar/AllLists";
import MobileSidebar from "@/components/shared/sidebar/MobileSidebar";
import Sidebar from "@/components/shared/sidebar/Sidebar";
import SidebarLayout from "@/components/shared/sidebar/SidebarLayout";
import { ReaderSettingsProvider } from "@/lib/readerSettings";
import { UserSettingsContextProvider } from "@/lib/userSettings";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";
import { TRPCError } from "@trpc/server";
import { TFunction } from "i18next";
import {
  Archive,
  ClipboardList,
  Highlighter,
  Home,
  Search,
  Tag,
} from "lucide-react";

import { PluginManager, PluginType } from "@karakeep/shared/plugins";
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

  // The mobile menu has no header logo to go home by and no room for the
  // profile menu's extras, so it keeps every destination.
  const items = (t: TFunction) =>
    [
      {
        name: t("common.home"),
        icon: <Home size={18} />,
        path: "/dashboard/bookmarks",
      },
      PluginManager.isRegistered(PluginType.Search)
        ? [
            {
              name: t("common.search"),
              icon: <Search size={18} />,
              path: "/dashboard/search",
            },
          ]
        : [],
      {
        name: t("common.tags"),
        icon: <Tag size={18} />,
        path: "/dashboard/tags",
      },
      {
        name: t("common.highlights"),
        icon: <Highlighter size={18} />,
        path: "/dashboard/highlights",
      },
      archive(t),
    ].flat();

  const mobileSidebar = (t: TFunction) => [
    ...items(t),
    {
      name: t("lists.all_lists"),
      icon: <ClipboardList size={18} />,
      path: "/dashboard/lists",
    },
  ];

  return (
    <UserSettingsContextProvider userSettings={userSettings.data}>
      <ReaderSettingsProvider>
        <SidebarLayout
          sidebar={
            // Desktop: the lists lead. Home is the header logo, search is the
            // header bar, Tags and Highlights are in the profile menu, and
            // Archive sits below the lists.
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
                    />
                  ),
                },
              ]}
            />
          }
          mobileSidebar={<MobileSidebar items={mobileSidebar} />}
          modal={modal}
        >
          {children}
        </SidebarLayout>
      </ReaderSettingsProvider>
    </UserSettingsContextProvider>
  );
}
