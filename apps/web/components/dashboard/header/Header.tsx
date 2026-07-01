import Link from "next/link";
import { redirect } from "next/navigation";
import GlobalActions from "@/components/dashboard/GlobalActions";
import ProfileOptions from "@/components/dashboard/header/ProfileOptions";
import { SearchInput } from "@/components/dashboard/search/SearchInput";
import KarakeepLogo from "@/components/KarakeepIcon";
import { getServerAuthSession } from "@/server/auth";

export default async function Header() {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  return (
    <header className="sticky left-0 right-0 top-0 z-50 flex h-20 items-center justify-between overflow-x-auto overflow-y-hidden bg-background pl-4 pr-5">
      <div className="hidden items-center sm:flex">
        <Link href={"/dashboard/bookmarks"} className="w-56">
          <KarakeepLogo height={38} />
        </Link>
      </div>
      {/* pl-5 matches the page content's own left inset (SidebarLayout's
          p-5), so the search bar lines up with the grid below it. */}
      <div className="flex flex-1 gap-2 pl-5">
        <SearchInput className="rounded-md bg-muted" />
        <GlobalActions />
      </div>
      <div className="flex items-center">
        <ProfileOptions />
      </div>
    </header>
  );
}
