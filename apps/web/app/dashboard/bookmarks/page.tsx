import React from "react";
import Bookmarks from "@/components/dashboard/bookmarks/Bookmarks";
import { PendingInvitationsCard } from "@/components/dashboard/lists/PendingInvitationsCard";

export default async function BookmarksPage() {
  return (
    <div>
      <Bookmarks
        query={{ archived: false }}
        sortKey="home"
        showEditorCard={true}
        // Fork: list invitations were on the All Lists page, now gone.
        header={<PendingInvitationsCard />}
      />
    </div>
  );
}
