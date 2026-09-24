import React from "react";
import { redirect } from "next/navigation";
import { AdminNotices } from "@/components/admin/AdminNotices";
import MobileTabBar from "@/components/shared/mobile/MobileTabBar";
import MobileSidebar from "@/components/shared/sidebar/MobileSidebar";
import Sidebar from "@/components/shared/sidebar/Sidebar";
import SidebarLayout from "@/components/shared/sidebar/SidebarLayout";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";
import { TFunction } from "i18next";
import { Activity, ArrowLeft, Settings, Users, Wrench } from "lucide-react";

import { tryCatch } from "@karakeep/shared/tryCatch";

const adminSidebarItems = (
  t: TFunction,
): {
  name: string;
  icon: React.ReactElement;
  path: string;
}[] => [
  {
    name: t("settings.back_to_app"),
    icon: <ArrowLeft size={18} />,
    path: "/dashboard/bookmarks",
  },
  {
    name: t("admin.server_stats.server_stats"),
    icon: <Activity size={18} />,
    path: "/admin/overview",
  },
  {
    name: t("admin.users_list.users_list"),
    icon: <Users size={18} />,
    path: "/admin/users",
  },
  {
    name: t("admin.background_jobs.background_jobs"),
    icon: <Settings size={18} />,
    path: "/admin/background_jobs",
  },
  {
    name: t("admin.admin_tools.admin_tools"),
    icon: <Wrench size={18} />,
    path: "/admin/admin_tools",
  },
];

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession();
  if (!session || session.user.role !== "admin") {
    redirect("/");
  }
  // For the phone's tab bar (its Lists sheet).
  const lists = await tryCatch(api.lists.list());

  return (
    <SidebarLayout
      sidebar={<Sidebar items={adminSidebarItems} />}
      mobileSidebar={
        // Fork: the phone's tab bar, and the admin pages' own icons.
        <>
          <MobileTabBar lists={lists.data ?? { lists: [] }} />
          <div className="border-b sm:hidden">
            <MobileSidebar items={adminSidebarItems} />
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <AdminNotices />
        {children}
      </div>
    </SidebarLayout>
  );
}
