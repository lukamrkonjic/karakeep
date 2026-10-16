import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestShareView } from "@/components/share/GuestShareView";
import { api } from "@/server/api/client";
import { TRPCError } from "@trpc/server";

/**
 * Fork: a guest link (Share with a guest…) — the lists ticked for it, to
 * look through without an account (components/share/). Anything wrong with
 * the token (deleted, reset) is simply "not found".
 */

async function loadView(token: string) {
  try {
    return await api.guestShares.view({ token });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      notFound();
    }
    throw e;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const view = await loadView(token);
  return {
    title: `Shared by ${view.ownerName} - vrana`,
    applicationName: "vrana",
    // A private link: never in a search engine.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function GuestSharePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const view = await loadView(token);
  return <GuestShareView token={token} initialView={view} />;
}
