import type { Metadata } from "next";
import DiscoverPage from "@/components/dashboard/discover/DiscoverPage";

export const metadata: Metadata = {
  title: "Discover | vrana",
};

// Fork: your own pictures you haven't seen in a while.
export default function Discover() {
  return <DiscoverPage />;
}
