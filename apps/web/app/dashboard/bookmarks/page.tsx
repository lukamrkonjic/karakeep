import React from "react";
import Bookmarks from "@/components/dashboard/bookmarks/Bookmarks";

export default async function BookmarksPage() {
  return (
    <div>
      <Bookmarks
        query={{ archived: false }}
        sortKey="home"
        showEditorCard={true}
      />
    </div>
  );
}
