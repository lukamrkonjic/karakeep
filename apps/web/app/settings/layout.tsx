import { redirect } from "next/navigation";
import SettingsPhoneNav from "@/components/settings/SettingsPhoneNav";
import MobileTabBar from "@/components/shared/mobile/MobileTabBar";
import Sidebar from "@/components/shared/sidebar/Sidebar";
import SidebarLayout from "@/components/shared/sidebar/SidebarLayout";
import { ReaderSettingsProvider } from "@/lib/readerSettings";
import { useTranslation } from "@/lib/i18n/server";
import { UserSettingsContextProvider } from "@/lib/userSettings";
import { api } from "@/server/api/client";
import { getServerAuthSession } from "@/server/auth";
import { TRPCError } from "@trpc/server";
import { TFunction } from "i18next";
import {
  ArrowLeft,
  BarChart3,
  CloudDownload,
  CreditCard,
  Download,
  GitBranch,
  Image,
  KeyRound,
  Link,
  RefreshCw,
  Rss,
  Sparkles,
  User,
  Webhook,
} from "lucide-react";

import serverConfig from "@karakeep/shared/config";
import { tryCatch } from "@karakeep/shared/tryCatch";

const settingsSidebarItems = (
  t: TFunction,
): {
  name: string;
  icon: React.ReactElement;
  path: string;
}[] => {
  return [
    {
      name: t("settings.back_to_app"),
      icon: <ArrowLeft size={18} />,
      path: "/dashboard/bookmarks",
    },
    {
      name: t("settings.info.user_info"),
      icon: <User size={18} />,
      path: "/settings/info",
    },
    {
      name: t("settings.stats.usage_statistics"),
      icon: <BarChart3 size={18} />,
      path: "/settings/stats",
    },
    ...(serverConfig.stripe.isConfigured
      ? [
          {
            name: t("settings.subscription.subscription"),
            icon: <CreditCard size={18} />,
            path: "/settings/subscription",
          },
        ]
      : []),
    ...(serverConfig.inference.isConfigured
      ? [
          {
            name: t("settings.ai.ai_settings"),
            icon: <Sparkles size={18} />,
            path: "/settings/ai",
          },
        ]
      : []),
    {
      name: t("settings.feeds.rss_subscriptions"),
      icon: <Rss size={18} />,
      path: "/settings/feeds",
    },
    {
      // Fork: the Pinterest-board subscriptions that keep lists in sync.
      name: "List subscriptions",
      icon: <RefreshCw size={18} />,
      path: "/settings/list-subscriptions",
    },
    {
      name: t("settings.backups.backups"),
      icon: <CloudDownload size={18} />,
      path: "/settings/backups",
    },
    {
      name: t("settings.import.import_export"),
      icon: <Download size={18} />,
      path: "/settings/import",
    },
    {
      name: t("settings.api_keys.api_keys"),
      icon: <KeyRound size={18} />,
      path: "/settings/api-keys",
    },
    {
      name: t("settings.broken_links.broken_links"),
      icon: <Link size={18} />,
      path: "/settings/broken-links",
    },
    {
      name: t("settings.webhooks.webhooks"),
      icon: <Webhook size={18} />,
      path: "/settings/webhooks",
    },
    {
      name: t("settings.rules.rules"),
      icon: <GitBranch size={18} />,
      path: "/settings/rules",
    },
    {
      name: t("settings.manage_assets.manage_assets"),
      icon: <Image size={18} />,
      path: "/settings/assets",
    },
  ];
};

export default async function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  const [userSettings, lists] = await Promise.all([
    tryCatch(api.users.settings()),
    // For the phone's tab bar (its Lists sheet).
    tryCatch(api.lists.list()),
  ]);
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();

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

  return (
    <UserSettingsContextProvider userSettings={userSettings.data}>
      <ReaderSettingsProvider>
        <SidebarLayout
          sidebar={<Sidebar items={settingsSidebarItems} />}
          // Fork: on a phone, the tab bar, and /settings lists the pages.
          mobileSidebar={<MobileTabBar lists={lists.data ?? { lists: [] }} />}
        >
          <SettingsPhoneNav
            items={settingsSidebarItems(t)}
            title={t("settings.user_settings")}
          />
          {children}
        </SidebarLayout>
      </ReaderSettingsProvider>
    </UserSettingsContextProvider>
  );
}
