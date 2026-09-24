"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import AllLists from "@/components/dashboard/sidebar/AllLists";
import { useToggleTheme } from "@/components/theme-provider";
import { BottomSheet, SheetItem } from "@/components/ui/bottom-sheet";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useSession } from "@/lib/auth/client";
import { haptic } from "@/lib/haptic";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import {
  Archive,
  ClipboardList,
  Highlighter,
  Home,
  LogOut,
  Menu,
  Moon,
  Newspaper,
  Paintbrush,
  Search,
  Settings,
  Shield,
  Star,
  Sun,
  Tag,
} from "lucide-react";
import { useTheme } from "next-themes";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useWhoAmI } from "@karakeep/shared-react/hooks/users";

/**
 * Fork: the phone's navigation, as in a native app — a tab bar at the bottom,
 * in thumb reach: Home, the tailored feed, the lists (a sheet), search, and
 * More (everything else, from favourites to settings). From sm up the
 * sidebar does this, and the bar is hidden.
 */

// Pages the More sheet leads to: its tab is lit while one is open.
const MORE_PAGES = [
  "/dashboard/favourites",
  "/dashboard/tags",
  "/dashboard/archive",
  "/dashboard/highlights",
  "/dashboard/cleanups",
  "/settings",
  "/admin",
];

function MoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session } = useSession();
  const { data: whoami } = useWhoAmI();
  const toggleTheme = useToggleTheme();
  const { theme } = useTheme();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="More">
      {session && (
        <div className="flex items-center gap-3 px-3 pb-3">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black text-white">
            <UserAvatar
              image={whoami?.image ?? null}
              name={session.user.name}
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{session.user.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {session.user.email}
            </p>
          </div>
        </div>
      )}
      <SheetItem icon={<Star />} onClick={() => go("/dashboard/favourites")}>
        {t("lists.favourites")}
      </SheetItem>
      <SheetItem icon={<Tag />} onClick={() => go("/dashboard/tags")}>
        {t("common.tags")}
      </SheetItem>
      <SheetItem icon={<Archive />} onClick={() => go("/dashboard/archive")}>
        {t("common.archive")}
      </SheetItem>
      <SheetItem
        icon={<Highlighter />}
        onClick={() => go("/dashboard/highlights")}
      >
        {t("common.highlights")}
      </SheetItem>
      <Separator className="my-2" />
      <SheetItem
        icon={<Paintbrush />}
        onClick={() => go("/dashboard/cleanups")}
      >
        {t("cleanups.cleanups")}
      </SheetItem>
      <SheetItem icon={<Settings />} onClick={() => go("/settings")}>
        {t("settings.user_settings")}
      </SheetItem>
      {session?.user.role === "admin" && (
        <SheetItem icon={<Shield />} onClick={() => go("/admin")}>
          {t("admin.admin_settings")}
        </SheetItem>
      )}
      <Separator className="my-2" />
      <SheetItem
        icon={theme === "dark" ? <Sun /> : <Moon />}
        onClick={toggleTheme}
      >
        {theme === "dark" ? t("options.light_mode") : t("options.dark_mode")}
      </SheetItem>
      <SheetItem icon={<LogOut />} onClick={() => go("/logout")}>
        {t("actions.sign_out")}
      </SheetItem>
    </BottomSheet>
  );
}

export default function MobileTabBar({
  lists,
}: {
  lists: { lists: ZBookmarkList[] };
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [sheet, setSheet] = useState<"lists" | "more" | null>(null);
  // Picking anything in a sheet navigates, and that closes it.
  useEffect(() => setSheet(null), [pathname]);

  const tabs: {
    label: string;
    icon: React.ReactNode;
    active: boolean;
    href?: string;
    sheet?: "lists" | "more";
  }[] = [
    {
      label: t("common.home"),
      icon: <Home />,
      href: "/dashboard/bookmarks",
      active: pathname === "/dashboard/bookmarks",
    },
    {
      label: "Feed",
      icon: <Newspaper />,
      href: "/dashboard/feed",
      active: pathname.startsWith("/dashboard/feed"),
    },
    {
      label: "Lists",
      icon: <ClipboardList />,
      sheet: "lists",
      active: pathname.startsWith("/dashboard/lists"),
    },
    {
      label: t("common.search"),
      icon: <Search />,
      href: "/dashboard/search",
      active: pathname.startsWith("/dashboard/search"),
    },
    {
      label: "More",
      icon: <Menu />,
      sheet: "more",
      active: MORE_PAGES.some((page) => pathname.startsWith(page)),
    },
  ];

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:hidden">
        <ul className="flex h-14">
          {tabs.map((tab) => {
            const look = cn(
              "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium [&_svg]:size-[22px]",
              tab.active || sheet === tab.sheet
                ? "text-foreground [&_svg]:stroke-[2.25]"
                : "text-muted-foreground",
            );
            return (
              <li key={tab.label} className="flex-1">
                {tab.href ? (
                  <Link href={tab.href} onClick={haptic} className={look}>
                    {tab.icon}
                    {tab.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={look}
                    onClick={() => {
                      haptic();
                      setSheet(tab.sheet ?? null);
                    }}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <BottomSheet
        open={sheet === "lists"}
        onOpenChange={(open) => setSheet(open ? "lists" : null)}
        title="Lists"
        bodyClassName="flex flex-col [&_a]:py-2.5"
      >
        <AllLists initialData={lists} pages={false} />
      </BottomSheet>
      <MoreSheet
        open={sheet === "more"}
        onOpenChange={(open) => setSheet(open ? "more" : null)}
      />
    </>
  );
}
