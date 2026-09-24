import type { Metadata } from "next";
import ListSubscriptionSettings from "@/components/settings/ListSubscriptionSettings";

export const metadata: Metadata = {
  title: "List subscriptions | vrana",
};

export default function ListSubscriptionsSettingsPage() {
  return <ListSubscriptionSettings />;
}
