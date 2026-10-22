import type { Metadata } from "next";
import CleanupsSettings from "@/components/settings/CleanupsSettings";

export const metadata: Metadata = {
  title: "Cleanups | vrana",
};

export default function CleanupsSettingsPage() {
  return <CleanupsSettings />;
}
