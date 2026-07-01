import { useTranslation } from "@/lib/i18n/server";
import { TFunction } from "i18next";

import SidebarItem from "./SidebarItem";
import { TSidebarItem } from "./TSidebarItem";

export default async function Sidebar({
  items,
  extraSections,
}: {
  items: (t: TFunction) => TSidebarItem[];
  extraSections?: React.ReactNode;
}) {
  // oxlint-disable-next-line rules-of-hooks
  const { t } = await useTranslation();

  return (
    <aside className="flex h-[calc(100vh-80px)] w-60 flex-col gap-5 p-4 pt-5">
      <div>
        <ul className="space-y-2 text-sm">
          {items(t).map((item) => (
            <SidebarItem
              key={item.name}
              logo={item.icon}
              name={item.name}
              path={item.path}
            />
          ))}
        </ul>
      </div>
      {extraSections}
    </aside>
  );
}
