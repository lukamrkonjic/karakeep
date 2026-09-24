"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Fork: getting around Settings without the sidebar. /settings is the list of
 * its pages (what the tab bar's More leads to); every page under it starts
 * with a way back to that list on a phone.
 */
export default function SettingsPhoneNav({
  items,
  title,
}: {
  items: { name: string; icon: React.ReactNode; path: string }[];
  title: string;
}) {
  const pathname = usePathname();
  const pages = items.filter((item) => item.path.startsWith("/settings"));
  if (pathname === "/settings") {
    return (
      <nav className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {pages.map((page) => (
            <li key={page.path}>
              <Link
                href={page.path}
                className="flex min-h-12 items-center gap-3 px-4 active:bg-muted [&_svg]:size-5 [&_svg]:shrink-0"
              >
                {page.icon}
                <span className="min-w-0 flex-1 truncate">{page.name}</span>
                <ChevronRight className="text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <Link
      href="/settings"
      className="-ml-1 mb-3 inline-flex min-h-10 items-center gap-0.5 text-sm text-muted-foreground sm:hidden"
    >
      <ChevronLeft className="size-5" />
      {title}
    </Link>
  );
}
