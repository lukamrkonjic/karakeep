import { redirect } from "next/navigation";

// Fork: Cleanups moved to Settings → Cleanups.
export default function Cleanups() {
  redirect("/settings/cleanups");
}
