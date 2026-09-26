import type { Metadata } from "next";
import PictureSettings from "@/components/settings/PictureSettings";

export const metadata: Metadata = {
  title: "Pictures | vrana",
};

export default function PictureSettingsPage() {
  return <PictureSettings />;
}
