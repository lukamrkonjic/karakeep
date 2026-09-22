import type { Metadata } from "next";
import TailoredFeed from "@/components/dashboard/feed/TailoredFeed";

export const metadata: Metadata = {
  title: "Tailored feed | Karakeep",
};

export default function TailoredFeedPage() {
  return <TailoredFeed />;
}
