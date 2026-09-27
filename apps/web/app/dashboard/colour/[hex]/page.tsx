import type { Metadata } from "next";
import ColourPage from "@/components/dashboard/pictures/ColourPage";

export const metadata: Metadata = {
  title: "Colour | vrana",
};

// Fork: pictures by colour — a family ("red") or a colour ("286ff0").
export default async function Colour(props: {
  params: Promise<{ hex: string }>;
}) {
  const { hex } = await props.params;
  return <ColourPage colour={decodeURIComponent(hex)} />;
}
