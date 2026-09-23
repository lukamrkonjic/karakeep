import { redirect } from "next/navigation";

// Fork: there's no All Lists page — everything on it is in the sidebar (on a
// phone, the lists panel), and the sidebar's first entry is Home. Old links
// land there.
export default function ListsPage() {
  redirect("/dashboard/bookmarks");
}
