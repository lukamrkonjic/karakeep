"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { PreviewDialog } from "@/components/dashboard/preview/PreviewDialog";

export default function BookmarkPreviewPage(props: {
  params: Promise<{ bookmarkId: string }>;
}) {
  const params = use(props.params);
  const router = useRouter();
  return (
    <PreviewDialog
      bookmarkId={params.bookmarkId}
      onClose={() => router.back()}
    />
  );
}
