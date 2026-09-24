import Link from "next/link";
import { redirect } from "next/navigation";
import ProfileOptions from "@/components/dashboard/header/ProfileOptions";
import HeaderMiddle from "@/components/dashboard/header/HeaderMiddle";
import KarakeepLogo from "@/components/KarakeepIcon";
import SidebarCollapseToggle from "@/components/shared/sidebar/SidebarCollapseToggle";
import { getServerAuthSession } from "@/server/auth";

export default async function Header() {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  return (
    <header className="sticky left-0 right-0 top-0 z-50 flex h-14 w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden bg-background pl-4 pr-2 sm:h-20 sm:pr-5">
      <div className="hidden w-56 shrink-0 items-center sm:flex xl:w-[17rem]">
        <Link
          href="/dashboard/bookmarks"
          aria-label="Home"
          className="transition-opacity hover:opacity-70"
        >
          <KarakeepLogo height={38} />
        </Link>
        <SidebarCollapseToggle />
      </div>
      {/* Its sm:pl-5 matches the page content's own left inset
          (SidebarLayout's p-5), so the search bar lines up with the grid. */}
      <HeaderMiddle />
      {/* Fork: on a phone the tab bar's More has all of this. */}
      <div className="hidden shrink-0 items-center sm:flex">
        <ProfileOptions />
      </div>
    </header>
  );
}
