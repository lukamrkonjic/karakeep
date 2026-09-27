import type { Metadata } from "next";
import ColourPage from "@/components/dashboard/pictures/ColourPage";

export const metadata: Metadata = {
  title: "Colour | vrana",
};

// Fork: search by colour — the pictures with a colour in them.
export default async function Colour(props: {
  params: Promise<{ hex: string }>;
}) {
  const { hex } = await props.params;
  return <ColourPage hex={hex} />;
}
