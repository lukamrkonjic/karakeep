"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AllLists from "@/components/dashboard/sidebar/AllLists";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { haptic } from "@/lib/haptic";
import { ClipboardList } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";

/**
 * Fork: the phone's way to the lists. There's no All Lists page any more (on
 * a desktop the sidebar has everything), so the mobile bar's list icon opens
 * the sidebar's lists in a panel, which closes once you pick one.
 */
export default function MobileListsMenu({
  initialData,
}: {
  initialData: { lists: ZBookmarkList[] };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <li className="flex w-full rounded-lg hover:bg-background">
        <DialogTrigger asChild>
          <button
            type="button"
            onClick={haptic}
            aria-label="Lists"
            className="m-auto px-3 py-2"
          >
            <ClipboardList size={18} />
          </button>
        </DialogTrigger>
      </li>
      {/* pt-12: the lists' own header (with its +) starts below the
          dialog's close button. */}
      <DialogContent
        className="max-h-[85vh] overflow-y-auto pt-12"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Lists</DialogTitle>
        <AllLists initialData={initialData} />
      </DialogContent>
    </Dialog>
  );
}
