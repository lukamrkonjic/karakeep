"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { SettingsSection } from "./SettingsPage";

/**
 * Fork: connecting Instagram for list subscriptions. Instagram has no way to
 * sign an app in to your saved collections, so it's your browser's session
 * cookie you paste here; the server checks it with Instagram and keeps it
 * encrypted (routers/instagram.ts). It is never shown again.
 */
export function InstagramConnection() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const [session, setSession] = useState("");
  const statusQuery = api.instagram.status.queryOptions();
  const { data: connection } = useQuery(statusQuery);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: statusQuery.queryKey });

  const { mutate: connect, isPending: isConnecting } = useMutation(
    api.instagram.connect.mutationOptions({
      onSuccess: (result) => {
        setSession("");
        void refresh();
        toast({
          description: result.username
            ? `Connected as @${result.username}`
            : "Instagram connected",
        });
      },
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const { mutate: disconnect, isPending: isDisconnecting } = useMutation(
    api.instagram.disconnect.mutationOptions({
      onSuccess: () => void refresh(),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );

  const who = connection?.username ? `@${connection.username}` : "your account";
  return (
    <SettingsSection
      title="Instagram"
      description="Lets lists subscribe to your Instagram saved collections. Instagram has no way to sign apps in to those, so Karakeep uses your browser's session instead."
    >
      <div className="flex flex-col gap-4 text-sm">
        {connection?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <p>
              {connection.status === "ok" ? (
                <>
                  Connected as <span className="font-medium">{who}</span>.
                </>
              ) : (
                <span className="text-destructive">
                  Instagram signed out the session for {who}. Paste a fresh one
                  below.
                </span>
              )}
            </p>
            <ActionButton
              variant="outline"
              size="sm"
              loading={isDisconnecting}
              onClick={() => disconnect()}
            >
              Disconnect
            </ActionButton>
          </div>
        ) : (
          <p className="text-muted-foreground">Not connected.</p>
        )}

        {/* The three steps sit right above the field they end in. */}
        <div className="flex flex-col gap-2">
          <p className="font-medium">How to connect</p>
          {/* Fork: a phone's browser can't show its cookies. */}
          <p className="text-muted-foreground sm:hidden">
            Do this on a computer: a phone&apos;s browser doesn&apos;t show its
            cookies. Once pasted there, it works on the phone too.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <a
                href="https://www.instagram.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                Open Instagram
                <ExternalLink className="size-3.5" />
              </a>{" "}
              and make sure you&apos;re logged in.
            </li>
            <li>
              Press F12 (⌥⌘I on a Mac) →{" "}
              <span className="text-foreground">Storage</span> (Firefox, Safari)
              or <span className="text-foreground">Application</span> (Chrome,
              Edge) → Cookies → https://www.instagram.com.
            </li>
            <li>
              Double-click the value next to <code>sessionid</code>, copy it
              (Ctrl+A, Ctrl+C — ⌘ on a Mac) and paste it here:
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            In Safari, first turn on Settings → Advanced → “Show features for
            web developers”.
          </p>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (session.trim()) {
              connect({ session: session.trim() });
            }
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            value={session}
            onChange={(e) => setSession(e.target.value)}
            placeholder="Paste your sessionid cookie"
            aria-label="Instagram session (sessionid cookie)"
            // The card is grey already: the field stands out in the page's colour.
            className="bg-background"
          />
          <ActionButton
            type="submit"
            loading={isConnecting}
            disabled={!session.trim()}
          >
            {connection?.connected ? "Replace" : "Connect"}
          </ActionButton>
        </form>

        <p className="text-muted-foreground">
          The session is as good as your password: it&apos;s kept encrypted on
          this server and never shown again. Logging out of Instagram in that
          browser ends it. Instagram doesn&apos;t allow automated reading, so
          syncs go slowly, but Instagram may still ask you to confirm it&apos;s
          you, or slow you down.
        </p>
        {connection?.connected && connection.status === "ok" && (
          <p className="text-muted-foreground">
            Then add a collection from a list: “…” → Add subscription, and paste
            its link (like instagram.com/you/saved/menswear/1790…/).
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
