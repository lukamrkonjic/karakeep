"use client";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/client";
import { Plus } from "lucide-react";

import { EditListModal } from "./EditListModal";

/**
 * The All Lists page's "New list" button.
 *
 * A client component on purpose. The page itself is a server one, and Radix's
 * `asChild` trigger works by cloning its child to put the trigger's props on
 * it: a child handed down from a server component is still an unresolved
 * reference while the server renders, so the trigger cloned nothing, the
 * button was missing from the server's HTML, and it appeared only once the
 * page hydrated — which is the hydration mismatch this page used to log.
 * Created here, the child is a plain element by the time Radix sees it.
 */
export function NewListButton() {
  const { t } = useTranslation();
  return (
    <EditListModal>
      <Button className="h-11 gap-2 rounded-lg">
        <Plus className="size-4" />
        <span>{t("lists.new_list")}</span>
      </Button>
    </EditListModal>
  );
}
