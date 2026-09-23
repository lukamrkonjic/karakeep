"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePreference, useUpdatePreferences } from "@/lib/uiPreferences";
import { Play, Volume2 } from "lucide-react";

import { SettingsSection } from "./SettingsPage";

/**
 * Fork: how feed videos behave (BookmarkVideo) — play while pointed at, and
 * whether with sound. Kept in the account like every UI preference.
 */
export default function VideoSettings() {
  const playOnHover = usePreference("hoverVideoAutoplay") ?? true;
  const withSound = usePreference("hoverVideoSound") ?? false;
  const updatePreferences = useUpdatePreferences();

  return (
    <SettingsSection
      title="Videos"
      description="How videos in your feed behave before you open them."
    >
      <div className="flex items-center justify-between gap-4">
        <Label
          htmlFor="hover-video-autoplay"
          className="flex cursor-pointer flex-col gap-1"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Play className="h-4 w-4" />
            Play videos on hover
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            A video starts playing while you point at it, and stops when you
            move away.
          </span>
        </Label>
        <Switch
          id="hover-video-autoplay"
          checked={playOnHover}
          onCheckedChange={(checked) =>
            void updatePreferences({ hoverVideoAutoplay: checked })
          }
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Volume2 className="h-4 w-4" />
          Sound while hovering
        </Label>
        <Select
          disabled={!playOnHover}
          value={withSound ? "sound" : "muted"}
          onValueChange={(value) =>
            void updatePreferences({ hoverVideoSound: value === "sound" })
          }
        >
          <SelectTrigger className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="muted">Muted</SelectItem>
            <SelectItem value="sound">With sound</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Browsers only allow sound once you&apos;ve clicked somewhere on the
          page; until then, videos play muted.
        </p>
      </div>
    </SettingsSection>
  );
}
