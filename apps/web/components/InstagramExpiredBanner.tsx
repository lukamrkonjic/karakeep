"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import type { ZInstagramConnection } from "@karakeep/shared/types/listSubscriptions";
import { useTRPC } from "@karakeep/shared-react/trpc";

const SETTINGS_PATH = "/settings/list-subscriptions";

/**
 * Fork: an orange strip across the top of the app once Instagram has signed
 * out the session list subscriptions read collections with (a sync or the
 * workers' daily check found out). Closing it is kept on the account for
 * that expiry, so it only comes back if a later session expires too.
 */
export default function InstagramExpiredBanner({
  initialData,
}: {
  /** The server's answer, so the strip is there on the first paint. */
  initialData: ZInstagramConnection | null;
}) {
  const api = useTRPC();
  const { data: connection } = useQuery(
    api.instagram.status.queryOptions(undefined, {
      initialData: initialData ?? undefined,
    }),
  );
  const dismissed = usePreference("instagramExpiryDismissed");
  const updatePreferences = useUpdatePreferences();
  const pathname = usePathname();

  // When it was found expired: what closing the strip remembers.
  const expiry =
    connection?.status === "expired"
      ? (connection.checkedAt?.toISOString() ?? "expired")
      : null;
  if (
    !expiry ||
    expiry === dismissed ||
    // The settings page says it itself, beside the field that fixes it.
    pathname.startsWith(SETTINGS_PATH)
  ) {
    return null;
  }
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 bg-orange-500 py-1.5 pl-4 pr-2 text-sm text-orange-950"
    >
      <p className="min-w-0 flex-1">
        Your Instagram cookie has expired, so your Instagram collections have
        stopped syncing.{" "}
        <Link
          href={SETTINGS_PATH}
          className="font-semibold underline underline-offset-2"
        >
          Paste a new one in Settings
        </Link>
      </p>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        className="shrink-0 rounded p-1 hover:bg-orange-950/10"
        onClick={() =>
          void updatePreferences(
            { instagramExpiryDismissed: expiry },
            { immediate: true },
          )
        }
      >
        <X size={16} />
      </button>
    </div>
  );
}
