"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import RelativeTime from "@/components/ui/relative-time";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ZPictureJobStatus,
  ZPictureSettings,
} from "@karakeep/shared/types/pictures";
import { useTRPC } from "@karakeep/shared-react/trpc";

import { SettingsPage, SettingsSection } from "./SettingsPage";

/**
 * Fork: Settings → Pictures. The picture model (Immich's CLIP, in the
 * workers) gives every picture a fingerprint; similar pictures, search by
 * description, list suggestions, duplicate pictures and near-duplicates
 * skipped on import work on them. Each runs as its own job.
 */

type Settings = ZPictureSettings;

function usePictureSettings() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(api.pictures.settings.queryOptions());
  const { mutate } = useMutation(
    api.pictures.updateSettings.mutationOptions({
      onSuccess: (settings) => {
        queryClient.setQueryData(api.pictures.settings.queryKey(), settings);
        void queryClient.invalidateQueries(api.pictures.status.pathFilter());
      },
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  return {
    settings: data,
    update: (changes: Partial<Settings>) => mutate(changes),
  };
}

function busy(status: ZPictureJobStatus["status"]) {
  return status === "waiting" || status === "pending" || status === "running";
}

function usePicturesStatus() {
  const api = useTRPC();
  return useQuery(
    api.pictures.status.queryOptions(undefined, {
      refetchInterval: (query) => {
        const data = query.state.data;
        return data &&
          (busy(data.fingerprints.status) || busy(data.suggestions.status))
          ? 3000
          : false;
      },
    }),
  ).data;
}

/** "Running…", "Last run 5 minutes ago: …", or what went wrong. */
function JobLine({ job }: { job: ZPictureJobStatus }) {
  if (job.status === "waiting") {
    return <span>Waiting for the fingerprints…</span>;
  }
  if (job.status === "pending") {
    return <span>Waiting for the workers…</span>;
  }
  if (job.status === "running") {
    return <span>Running…</span>;
  }
  if (job.status === "never" || !job.finishedAt) {
    return <span className="text-muted-foreground">Hasn&apos;t run yet.</span>;
  }
  if (job.status === "failed") {
    return (
      <span className="text-destructive">
        Failed <RelativeTime date={job.finishedAt} />
        {job.error ? `: ${job.error}` : ""}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      Last run <RelativeTime date={job.finishedAt} />
      {job.detail ? `: ${job.detail}.` : "."}
    </span>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      {/* Wide enough to read: on a phone the control goes under it. */}
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as T)}
      disabled={disabled}
    >
      <SelectTrigger className="w-60" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Fingerprints({ settings, update }: SectionProps) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const status = usePicturesStatus();
  const { mutate: now, isPending } = useMutation(
    api.pictures.fingerprintNow.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries(api.pictures.status.pathFilter()),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const job = status?.fingerprints;
  return (
    <SettingsSection
      title="Fingerprints"
      description="The picture model looks at each picture once — a video by its first frame — and keeps a fingerprint of it. Everything below works on these."
    >
      <div className="flex flex-col gap-5">
        <Row
          label="Look at new pictures"
          hint="Every hour on the half hour, or every night at 2:30."
        >
          <Choice
            label="Look at new pictures"
            value={settings.fingerprintSchedule}
            onChange={(fingerprintSchedule) => update({ fingerprintSchedule })}
            options={[
              { value: "hourly", label: "Every hour" },
              { value: "nightly", label: "Every night" },
              { value: "manual", label: "Only when I ask" },
            ]}
          />
        </Row>
        {job && status && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ActionButton
              variant="outline"
              size="sm"
              loading={isPending}
              disabled={busy(job.status)}
              onClick={() => now()}
            >
              Fingerprint now
            </ActionButton>
            <span>
              {job.done.toLocaleString()} of {job.total.toLocaleString()}{" "}
              pictures have one.{" "}
            </span>
            <JobLine job={job} />
            {!status.models.picture && (
              <span className="text-muted-foreground">
                The picture model (0.35 GB) downloads on the first run.
              </span>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

interface SectionProps {
  settings: Settings;
  update: (changes: Partial<Settings>) => void;
}

function Similar({ settings, update }: SectionProps) {
  return (
    <SettingsSection
      title="Similar pictures"
      description="“More like this”: a picture's details show the pictures most like it, from all your lists, with a page for all of them."
    >
      <div className="flex flex-col gap-5">
        <Row label="Show similar pictures">
          <Switch
            checked={settings.similarEnabled}
            onCheckedChange={(similarEnabled) => update({ similarEnabled })}
          />
        </Row>
        <Row label="How similar">
          <Choice
            label="How similar"
            value={settings.similarLevel}
            disabled={!settings.similarEnabled}
            onChange={(similarLevel) => update({ similarLevel })}
            options={[
              { value: "close", label: "Close: the same kind of picture" },
              { value: "related", label: "Related" },
              { value: "loose", label: "Loosely related" },
            ]}
          />
        </Row>
      </div>
    </SettingsSection>
  );
}

function Describe({ settings, update }: SectionProps) {
  const api = useTRPC();
  const [downloading, setDownloading] = useState(false);
  const { data: status } = useQuery(
    api.pictures.status.queryOptions(undefined, {
      // Until the workers have it.
      refetchInterval: (query) =>
        downloading && !query.state.data?.models.text ? 3000 : false,
    }),
  );
  const { mutate: prepare, isPending } = useMutation(
    api.pictures.prepareTextModel.mutationOptions({
      onMutate: () => setDownloading(true),
      onError: (e) => {
        setDownloading(false);
        toast({ variant: "destructive", description: e.message });
      },
    }),
  );
  return (
    <SettingsSection
      title="Search by description"
      description="Find pictures by what's in them — “comet over a dark sea”, “red armchair” — even untitled ones: Search → Pictures. Qualifiers like list:Art or #tag narrow it down."
    >
      <div className="flex flex-col gap-5">
        <Row label="Search pictures by describing them">
          <Switch
            checked={settings.describeEnabled}
            onCheckedChange={(describeEnabled) => update({ describeEnabled })}
          />
        </Row>
        <Row
          label="Matches"
          hint="How well a picture must fit the description to be shown."
        >
          <Choice
            label="Matches"
            value={settings.describeLevel}
            disabled={!settings.describeEnabled}
            onChange={(describeLevel) => update({ describeLevel })}
            options={[
              { value: "strict", label: "Only good matches" },
              { value: "balanced", label: "Balanced" },
              { value: "loose", label: "Anything close" },
            ]}
          />
        </Row>
        {status && settings.describeEnabled && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {status.models.text ? (
              <span>The text model is downloaded.</span>
            ) : downloading ? (
              <span>Downloading the text model (0.25 GB)…</span>
            ) : (
              <>
                <ActionButton
                  variant="outline"
                  size="sm"
                  loading={isPending}
                  onClick={() => prepare()}
                >
                  Download now
                </ActionButton>
                <span>
                  The text model (0.25 GB) downloads on the first search
                  otherwise.
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function Suggestions({ settings, update }: SectionProps) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const status = usePicturesStatus();
  const { mutate: now, isPending } = useMutation(
    api.pictures.suggestNow.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries(api.pictures.status.pathFilter()),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const job = status?.suggestions;
  return (
    <SettingsSection
      title="List suggestions"
      description="“Belongs in…”: a list suggested for each new picture, going by the lists its closest matches are in. They show in the picture's details and in Cleanups, to add with a click."
    >
      <div className="flex flex-col gap-5">
        <Row label="Suggest a list for new pictures">
          <Switch
            checked={settings.suggestionsEnabled}
            onCheckedChange={(suggestionsEnabled) =>
              update({ suggestionsEnabled })
            }
          />
        </Row>
        <Row label="How sure">
          <Choice
            label="How sure"
            value={settings.suggestionsLevel}
            disabled={!settings.suggestionsEnabled}
            onChange={(suggestionsLevel) => update({ suggestionsLevel })}
            options={[
              { value: "sure", label: "Only when sure" },
              { value: "likely", label: "When likely" },
              { value: "hunch", label: "Any hunch" },
            ]}
          />
        </Row>
        <Row label="For">
          <Choice
            label="Suggest for"
            value={settings.suggestionsScope}
            disabled={!settings.suggestionsEnabled}
            onChange={(suggestionsScope) => update({ suggestionsScope })}
            options={[
              { value: "new", label: "New pictures" },
              { value: "month", label: "The last 30 days' pictures" },
              { value: "all", label: "All pictures" },
            ]}
          />
        </Row>
        {job && settings.suggestionsEnabled && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ActionButton
              variant="outline"
              size="sm"
              loading={isPending}
              disabled={busy(job.status)}
              onClick={() => now()}
            >
              Suggest now
            </ActionButton>
            <Link
              href="/dashboard/cleanups"
              className="underline underline-offset-2 hover:text-muted-foreground"
            >
              {job.open.toLocaleString()} to look at
            </Link>
            <JobLine job={job} />
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function Duplicates({ settings, update }: SectionProps) {
  return (
    <SettingsSection
      title="Duplicate pictures"
      description="Pictures that show the same picture — resized, re-saved, recropped — listed in Cleanups to keep one."
    >
      <Row
        label="Look for duplicates"
        hint={
          <>
            Every night at 3:00, or with Check now in{" "}
            <Link
              href="/dashboard/cleanups"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cleanups
            </Link>
            .
          </>
        }
      >
        <Choice
          label="Look for duplicates"
          value={settings.duplicatesSchedule}
          onChange={(duplicatesSchedule) => update({ duplicatesSchedule })}
          options={[
            { value: "nightly", label: "Every night" },
            { value: "manual", label: "Only when I ask" },
          ]}
        />
      </Row>
    </SettingsSection>
  );
}

function ImportDuplicates({ settings, update }: SectionProps) {
  return (
    <SettingsSection
      title="Near-duplicates on import"
      description="A list subscription with “Skip near-duplicates” ticked links a picture it brings in to the one you have, when it's another copy of it, instead of downloading it again."
    >
      <Row
        label="Counts as the same picture"
        hint={
          <>
            Ticked per subscription: a list&apos;s “…” → Add subscription, or{" "}
            <Link
              href="/settings/list-subscriptions"
              className="underline underline-offset-2 hover:text-foreground"
            >
              List subscriptions
            </Link>
            .
          </>
        }
      >
        <Choice
          label="Counts as the same picture"
          value={settings.importDuplicateLevel}
          onChange={(importDuplicateLevel) => update({ importDuplicateLevel })}
          options={[
            { value: "identical", label: "Identical: resized or re-saved" },
            { value: "near", label: "Near-identical: also recropped" },
            { value: "similar", label: "Similar: also heavier edits" },
          ]}
        />
      </Row>
    </SettingsSection>
  );
}

export default function PictureSettings() {
  const { settings, update } = usePictureSettings();
  return (
    <SettingsPage
      title="Pictures"
      description="What the picture model does with your pictures. It runs on this server, in the workers: your pictures never leave it."
    >
      {settings && (
        <>
          <Fingerprints settings={settings} update={update} />
          <Similar settings={settings} update={update} />
          <Describe settings={settings} update={update} />
          <Suggestions settings={settings} update={update} />
          <Duplicates settings={settings} update={update} />
          <ImportDuplicates settings={settings} update={update} />
        </>
      )}
    </SettingsPage>
  );
}
