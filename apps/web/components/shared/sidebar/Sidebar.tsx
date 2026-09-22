import { Separator } from "@/components/ui/separator";
import { useTranslation } from "@/lib/i18n/server";
import { TFunction } from "i18next";

import SidebarItem from "./SidebarItem";
import { TSidebarItem } from "./TSidebarItem";

function SidebarItems({ items }: { items: TSidebarItem[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((item) => (
        <SidebarItem
          key={item.name}
          logo={item.icon}
          name={item.name}
          path={item.path}
        />
      ))}
    </ul>
  );
}

export default async function Sidebar({
  items,
  extraSections,
  footerItems,
}: {
  items?: (t: TFunction) => TSidebarItem[];
  extraSections?: React.ReactNode;
  /** Pinned below the extra sections, behind a divider. */
  footerItems?: (t: TFunction) => TSidebarItem[];
}) {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();
  const top = items?.(t) ?? [];
  const footer = footerItems?.(t) ?? [];

  return (
    <aside className="flex h-[calc(100vh-80px)] w-60 flex-col gap-5 p-4 pt-5 xl:w-72">
      {top.length > 0 && <SidebarItems items={top} />}
      {/* The sections take the height that is left and scroll inside it, so
          the footer stays in view however many lists there are. */}
      <div className="flex min-h-0 flex-1 flex-col">{extraSections}</div>
      {footer.length > 0 && (
        <div className="shrink-0">
          <Separator className="mb-3" />
          <SidebarItems items={footer} />
        </div>
      )}
    </aside>
  );
}
