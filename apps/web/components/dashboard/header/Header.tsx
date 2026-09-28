import { redirect } from "next/navigation";
import ProfileOptions from "@/components/dashboard/header/ProfileOptions";
import HeaderLogo from "@/components/dashboard/header/HeaderLogo";
import HeaderMiddle from "@/components/dashboard/header/HeaderMiddle";
import { getServerAuthSession } from "@/server/auth";

export default async function Header() {
  const session = await getServerAuthSession();
  if (!session) {
    redirect("/");
  }

  return (
    // Fork: in the Mac app (apps/desktop) the header is the title bar — its
    // empty parts move the window, a double-click zooms it; its buttons,
    // links and search work as ever. Nothing in a browser.
    <header
      data-tauri-drag-region="deep"
      className="sticky left-0 right-0 top-0 z-50 flex h-14 w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden bg-background pl-4 pr-2 sm:h-20 sm:pl-0 sm:pr-5"
    >
      <HeaderLogo />
      {/* Its sm:pl-3 and the header's gap-2 make the page content's own
          left inset (SidebarLayout's p-5), so with the sidebar open the
          search bar lines up with the grid. */}
      <HeaderMiddle />
      {/* Fork: on a phone the tab bar's More has all of this. */}
      <div className="hidden shrink-0 items-center sm:flex">
        <ProfileOptions />
      </div>
    </header>
  );
}
