import type { Metadata } from "next";
import DiscoverPage from "@/components/dashboard/discover/DiscoverPage";

export const metadata: Metadata = {
  title: "Discover | vrana",
};

// Fork: new pictures from Pinterest, like the pins you saved.
export default function Discover() {
  return <DiscoverPage />;
}
