import type { Metadata } from "next";
import TailoredFeed from "@/components/dashboard/feed/TailoredFeed";
import { api } from "@/server/api/client";

export const metadata: Metadata = {
  title: "Tailored feed | vrana",
};

export default async function TailoredFeedPage() {
  return <TailoredFeed initialLists={await api.lists.list()} />;
}
