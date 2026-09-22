"use client";

import Link from "next/link";
import {
  pollWhileSyncing,
  SubscriptionStatus,
  useRefreshWhenSynced,
} from "@/components/dashboard/lists/ListSubscriptionStatus";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUserSettings } from "@/lib/userSettings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { useUpdateUserSettings } from "@karakeep/shared-react/hooks/users";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { SUBSCRIPTION_INTERVAL_CHOICES } from "@karakeep/shared/types/listSubscriptions";

import { SettingsPage, SettingsSection } from "./SettingsPage";

/**
 * Fork: the schedule the subscription worker runs on, and every subscription
 * you have in one place. Subscriptions themselves are added from a list's
 * "…" menu.
 */

function intervalLabel(hours: number) {
  if (hours <= 0) {
    return "Only when I ask";
  }
  if (hours === 24) {
    return "Once a day";
  }
  if (hours === 168) {
    return "Once a week";
  }
  return `Every ${hours} hours`;
}

function Schedule() {
  const settings = useUserSettings();
  const { mutate: updateSettings } = useUpdateUserSettings({
    onSuccess: () => toast({ description: "Schedule updated" }),
    onError: () =>
      toast({
        description: "Failed to update the schedule",
        variant: "destructive",
      }),
  });

  return (
    <SettingsSection
      title="Schedule"
      description="How often the worker checks every subscribed source for new pictures. It only ever downloads what it hasn't taken before."
    >
      <Select
        value={String(settings.subscriptionIntervalHours)}
        onValueChange={(value) =>
          updateSettings({ subscriptionIntervalHours: Number(value) })
        }
      >
        <SelectTrigger className="w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUBSCRIPTION_INTERVAL_CHOICES.map((hours) => (
            <SelectItem key={hours} value={String(hours)}>
              {intervalLabel(hours)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsSection>
  );
}

function Subscriptions() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const options = api.listSubscriptions.listAll.queryOptions();
  const { data } = useQuery({ ...options, refetchInterval: pollWhileSyncing });
  useRefreshWhenSynced(data?.subscriptions);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: options.queryKey });
  const onError = (e: { message: string }) =>
    toast({ variant: "destructive", description: e.message });

  const { mutate: update } = useMutation(
    api.listSubscriptions.update.mutationOptions({
      onSuccess: () => void invalidate(),
      onError,
    }),
  );
  const { mutate: remove } = useMutation(
    api.listSubscriptions.delete.mutationOptions({
      onSuccess: () => void invalidate(),
      onError,
    }),
  );

  const subscriptions = data?.subscriptions ?? [];

  return (
    <SettingsSection
      title="Subscriptions"
      description="Add one by opening a list, clicking its “…” menu and choosing “Add subscription”."
    >
      {subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>List</TableHead>
              <TableHead>Last sync</TableHead>
              <TableHead className="w-24">Enabled</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((subscription) => (
              <TableRow key={subscription.id}>
                <TableCell className="max-w-72">
                  <a
                    href={subscription.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate hover:underline"
                    title={subscription.url}
                  >
                    {subscription.name ?? subscription.url}
                  </a>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/lists/${subscription.listId}`}
                    className="hover:underline"
                  >
                    {subscription.listName}
                  </Link>
                </TableCell>
                <TableCell className="max-w-80 truncate text-sm">
                  <SubscriptionStatus subscription={subscription} />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={subscription.enabled}
                    onCheckedChange={(enabled) =>
                      update({ subscriptionId: subscription.id, enabled })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="none"
                    className="p-2 text-destructive"
                    title="Remove the subscription (the pictures stay)"
                    aria-label="Remove subscription"
                    onClick={() => remove({ subscriptionId: subscription.id })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SettingsSection>
  );
}

export default function ListSubscriptionSettings() {
  return (
    <SettingsPage
      title="List subscriptions"
      description="Keep a list in sync with a public Pinterest board."
    >
      <Schedule />
      <Subscriptions />
    </SettingsPage>
  );
}
