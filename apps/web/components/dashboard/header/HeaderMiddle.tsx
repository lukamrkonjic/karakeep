"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import GlobalActions from "@/components/dashboard/GlobalActions";
import { SearchInput } from "@/components/dashboard/search/SearchInput";
import KarakeepLogo from "@/components/KarakeepIcon";
import { cn } from "@/lib/utils";

/**
 * Fork: the header's middle. On a desktop, the search bar and the page's
 * actions. On a phone the tab bar has Search, so the header shows the logo
 * and the actions — and on the search page, the search bar across it.
 */
export default function HeaderMiddle() {
  const onSearch = usePathname().startsWith("/dashboard/search");
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:pl-5">
      {!onSearch && (
        <Link
          href="/dashboard/bookmarks"
          aria-label="Home"
          className="mr-auto shrink-0 sm:hidden"
        >
          <KarakeepLogo height={26} />
        </Link>
      )}
      <SearchInput
        className={cn("rounded-md bg-muted", !onSearch && "max-sm:hidden")}
      />
      <GlobalActions />
    </div>
  );
}
