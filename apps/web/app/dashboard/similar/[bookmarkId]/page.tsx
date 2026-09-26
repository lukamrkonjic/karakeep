import type { Metadata } from "next";
import SimilarPicturesPage from "@/components/dashboard/pictures/SimilarPicturesPage";

export const metadata: Metadata = {
  title: "Similar pictures | vrana",
};

// Fork: "More like this" — all the pictures like one, from every list.
export default async function SimilarPage(props: {
  params: Promise<{ bookmarkId: string }>;
}) {
  const { bookmarkId } = await props.params;
  return <SimilarPicturesPage bookmarkId={bookmarkId} />;
}
