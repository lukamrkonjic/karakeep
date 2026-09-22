import type { Metadata } from "next";
import ListSubscriptionSettings from "@/components/settings/ListSubscriptionSettings";

export const metadata: Metadata = {
  title: "List subscriptions | Karakeep",
};

export default function ListSubscriptionsSettingsPage() {
  return <ListSubscriptionSettings />;
}
