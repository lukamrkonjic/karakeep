"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import type {
  ZPictureJobStatus,
  ZPictureSettings,
  ZPicturesStatus,
} from "@karakeep/shared/types/pictures";
import { useTRPC } from "@karakeep/shared-react/trpc";

import { SettingsPage } from "./SettingsPage";

/**
 * Fork: Settings → Pictures. The picture model (Immich's CLIP, in the
 * workers) indexes every picture — gives it a fingerprint — and similar
 * pictures, search by description, list suggestions, duplicates and
 * near-duplicates skipped on import work on that. The index on top, then one
 * row per feature.
 */

type Settings = ZPictureSettings;
type Update = (changes: Partial<Settings>) => void;

function busy(status: ZPictureJobStatus["status"]) {
  return status === "waiting" || status === "pending" || status === "running";
}

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
  const update: Update = (changes) => mutate(changes);
  return { settings: data, update };
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as T)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={cn("h-8 w-32 text-sm sm:w-36", className)}
      >
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

/** One feature: its name and a few words, then its controls. */
function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** A switch's room in a row without one, so the choices line up. */
function NoSwitch() {
  return <span aria-hidden className="w-11" />;
}

/** Where a job is: running, when it last ran, or that it failed. */
function JobState({ job }: { job: ZPictureJobStatus }) {
  if (busy(job.status)) {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" />
        {job.status === "running" ? "Running…" : "Waiting…"}
      </span>
    );
  }
  if (job.status === "failed") {
    return (
      <span className="text-destructive" title={job.error ?? undefined}>
        Failed {job.finishedAt && <RelativeTime date={job.finishedAt} />}
      </span>
    );
  }
  if (!job.finishedAt) {
    return <span>Never run</span>;
  }
  return (
    <span title={job.detail ?? undefined}>
      Last run <RelativeTime date={job.finishedAt} />
    </span>
  );
}

function IndexCard({
  settings,
  update,
  status,
}: {
  settings: Settings;
  update: Update;
  status: ZPicturesStatus | undefined;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { mutate: indexNow, isPending } = useMutation(
    api.pictures.fingerprintNow.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries(api.pictures.status.pathFilter()),
      onError: (e) => toast({ variant: "destructive", description: e.message }),
    }),
  );
  const job = status?.fingerprints;
  const percent = job?.total ? Math.floor((job.done / job.total) * 100) : 0;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">Index</p>
          <p className="text-xs text-muted-foreground">
            {job
              ? `${job.done.toLocaleString()} of ${job.total.toLocaleString()} pictures${job.unreadable > 0 ? ` · ${job.unreadable} unreadable` : ""}`
              : "…"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !job || busy(job.status)}
          onClick={() => indexNow()}
        >
          Index now
        </Button>
      </div>
      <Progress value={percent} className="h-1.5" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {job && <JobState job={job} />}
        <span aria-hidden>·</span>
        <span>New pictures</span>
        <Choice
          label="Index new pictures"
          value={settings.fingerprintSchedule}
          onChange={(fingerprintSchedule) => update({ fingerprintSchedule })}
          className="h-7 w-auto gap-1 bg-transparent px-1.5 text-xs"
          options={[
            { value: "hourly", label: "every hour" },
            { value: "nightly", label: "every night" },
            { value: "manual", label: "when I ask" },
          ]}
        />
      </div>
    </Card>
  );
}

/** Getting the text model ahead of the first search. */
function TextModel() {
  const api = useTRPC();
  const [asked, setAsked] = useState(false);
  // Until the workers have it: then the row goes back to its hint.
  useQuery(
    api.pictures.status.queryOptions(undefined, {
      enabled: asked,
      refetchInterval: asked ? 3000 : false,
    }),
  );
  const { mutate: download } = useMutation(
    api.pictures.prepareTextModel.mutationOptions({
      onMutate: () => setAsked(true),
      onError: (e) => {
        setAsked(false);
        toast({ variant: "destructive", description: e.message });
      },
    }),
  );
  return asked ? (
    <span className="inline-flex items-center gap-1">
      <Loader2 className="size-3 animate-spin" />
      Downloading the model…
    </span>
  ) : (
    <button
      type="button"
      onClick={() => download()}
      className="underline underline-offset-2 hover:text-foreground"
    >
      Download the model (0.25 GB)
    </button>
  );
}

export default function PictureSettings() {
  const api = useTRPC();
  const { settings, update } = usePictureSettings();
  const { data: status } = useQuery(
    api.pictures.status.queryOptions(undefined, {
      refetchInterval: (query) => {
        const data = query.state.data;
        return data &&
          (busy(data.fingerprints.status) || busy(data.suggestions.status))
          ? 3000
          : false;
      },
    }),
  );
  if (!settings) {
    return null;
  }
  const suggestions = status?.suggestions;

  return (
    <SettingsPage title="Pictures">
      <IndexCard settings={settings} update={update} status={status} />
      <Card className="divide-y">
        <Row title="Similar pictures" hint="In a picture's details">
          <Choice
            label="How similar"
            value={settings.similarLevel}
            disabled={!settings.similarEnabled}
            onChange={(similarLevel) => update({ similarLevel })}
            options={[
              { value: "close", label: "Close" },
              { value: "related", label: "Related" },
              { value: "loose", label: "Loosely" },
            ]}
          />
          <Switch
            aria-label="Similar pictures"
            checked={settings.similarEnabled}
            onCheckedChange={(similarEnabled) => update({ similarEnabled })}
          />
        </Row>
        <Row
          title="Search by description"
          hint={
            status && settings.describeEnabled && !status.models.text ? (
              <TextModel />
            ) : (
              "Search bar → Pictures"
            )
          }
        >
          <Choice
            label="Matches"
            value={settings.describeLevel}
            disabled={!settings.describeEnabled}
            onChange={(describeLevel) => update({ describeLevel })}
            options={[
              { value: "strict", label: "Good matches" },
              { value: "balanced", label: "Balanced" },
              { value: "loose", label: "Anything close" },
            ]}
          />
          <Switch
            aria-label="Search by description"
            checked={settings.describeEnabled}
            onCheckedChange={(describeEnabled) => update({ describeEnabled })}
          />
        </Row>
        <Row
          title="List suggestions"
          hint={
            suggestions && settings.suggestionsEnabled ? (
              busy(suggestions.status) ? (
                <JobState job={suggestions} />
              ) : (
                <Link
                  href="/dashboard/cleanups"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {suggestions.open.toLocaleString()} to review
                </Link>
              )
            ) : (
              "A list for each new picture"
            )
          }
        >
          <Choice
            label="Suggest for"
            value={settings.suggestionsScope}
            disabled={!settings.suggestionsEnabled}
            onChange={(suggestionsScope) => update({ suggestionsScope })}
            options={[
              { value: "new", label: "New pictures" },
              { value: "month", label: "Last 30 days" },
              { value: "all", label: "All pictures" },
            ]}
          />
          <Choice
            label="How sure"
            value={settings.suggestionsLevel}
            disabled={!settings.suggestionsEnabled}
            onChange={(suggestionsLevel) => update({ suggestionsLevel })}
            className="w-24 sm:w-28"
            options={[
              { value: "sure", label: "Sure" },
              { value: "likely", label: "Likely" },
              { value: "hunch", label: "Any hunch" },
            ]}
          />
          <Switch
            aria-label="List suggestions"
            checked={settings.suggestionsEnabled}
            onCheckedChange={(suggestionsEnabled) =>
              update({ suggestionsEnabled })
            }
          />
        </Row>
        <Row
          title="Duplicates"
          hint={
            <Link
              href="/dashboard/cleanups"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Review in Cleanups
            </Link>
          }
        >
          <Choice
            label="Look for duplicates"
            value={settings.duplicatesSchedule}
            onChange={(duplicatesSchedule) => update({ duplicatesSchedule })}
            options={[
              { value: "nightly", label: "Every night" },
              { value: "manual", label: "When I ask" },
            ]}
          />
          <NoSwitch />
        </Row>
        <Row
          title="Skip near-duplicates"
          hint="On import, for subscriptions that have it on"
        >
          <Choice
            label="Counts as the same picture"
            className="w-36"
            value={settings.importDuplicateLevel}
            onChange={(importDuplicateLevel) =>
              update({ importDuplicateLevel })
            }
            options={[
              { value: "identical", label: "Identical" },
              { value: "near", label: "Near-identical" },
              { value: "similar", label: "Similar" },
            ]}
          />
          <NoSwitch />
        </Row>
      </Card>
    </SettingsPage>
  );
}
