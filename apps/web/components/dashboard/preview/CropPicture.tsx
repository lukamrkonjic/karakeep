"use client";

import "react-image-crop/dist/ReactCrop.css";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { PercentCrop } from "react-image-crop";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";

import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  zUploadErrorSchema,
  zUploadResponseSchema,
} from "@karakeep/shared/types/uploads";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

/** The shapes a crop can keep to; Free drags each edge on its own. */
const SHAPES: { label: string; aspect?: number | "original" }[] = [
  { label: "Free" },
  { label: "Original", aspect: "original" },
  { label: "1:1", aspect: 1 },
  { label: "4:5", aspect: 4 / 5 },
  { label: "3:4", aspect: 3 / 4 },
  { label: "16:9", aspect: 16 / 9 },
];

/** A phone's browser draws no bigger a canvas (Safari: 16.7 megapixels). */
const MAX_PIXELS = 16_000_000;

const ALL: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };

interface Size {
  width: number;
  height: number;
}

/** The crop in the picture's own pixels. */
function pixelsOf(crop: PercentCrop, { width: w, height: h }: Size) {
  const x = Math.round((crop.x / 100) * w);
  const y = Math.round((crop.y / 100) * h);
  return {
    x,
    y,
    width: Math.max(1, Math.min(w - x, Math.round((crop.width / 100) * w))),
    height: Math.max(1, Math.min(h - y, Math.round((crop.height / 100) * h))),
  };
}

/** Kept as it was where a browser can write it: PNG, WebP; else JPEG. */
function typeFor(source: string) {
  if (source === "image/png" || source === "image/gif") {
    return "image/png";
  }
  return source === "image/webp" ? "image/webp" : "image/jpeg";
}

/** Uploads a file (as a new bookmark's would be): its asset's id. */
async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch("/api/assets", { method: "POST", body: form });
  if (!resp.ok) {
    const text = await resp.text();
    let message = text || "The upload failed.";
    try {
      message = zUploadErrorSchema.parse(JSON.parse(text)).error;
    } catch {
      // Not the server's own error: the text as it is.
    }
    throw new Error(message);
  }
  return zUploadResponseSchema.parse(await resp.json()).assetId;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/**
 * Fork: crop a picture, for good — the frame dragged over the whole picture
 * (the rest dimmed), the result as it will be beside it, with its size.
 * Save draws the crop at the picture's full resolution, uploads it and
 * makes it the bookmark's file in the old one's place
 * (routers/pictures.ts replacePicture), which deletes the old one.
 */
export function CropPicture({
  bookmarkId,
  assetId,
  fileName,
  open,
  onOpenChange,
}: {
  bookmarkId: string;
  assetId: string;
  fileName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const image = useRef<HTMLImageElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<{ url: string; type: string }>();
  const [failed, setFailed] = useState(false);
  // The picture's own size, once it's loaded.
  const [natural, setNatural] = useState<Size>();
  const [crop, setCrop] = useState<PercentCrop>(ALL);
  const [shape, setShape] = useState(0);
  const [saving, setSaving] = useState(false);

  // The file itself, from here: a canvas may then be read back.
  useEffect(() => {
    if (!open) {
      return;
    }
    let url: string | undefined;
    let gone = false;
    setFailed(false);
    fetch(getAssetUrl(assetId))
      .then((resp) => (resp.ok ? resp.blob() : Promise.reject()))
      .then((blob) => {
        if (gone) {
          return;
        }
        url = URL.createObjectURL(blob);
        setSource({ url, type: blob.type });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
      setSource(undefined);
      setNatural(undefined);
      setCrop(ALL);
      setShape(0);
    };
  }, [open, assetId]);

  const aspectOf = (index: number, size: Size) => {
    const aspect = SHAPES[index].aspect;
    return aspect === "original" ? size.width / size.height : aspect;
  };
  const aspect = natural ? aspectOf(shape, natural) : undefined;

  const pickShape = (index: number) => {
    setShape(index);
    const next = natural && aspectOf(index, natural);
    if (!natural || !next) {
      return;
    }
    // As big as it goes in that shape, in the middle.
    const w = natural.width;
    const h = natural.height;
    setCrop(
      centerCrop(
        makeAspectCrop(
          { unit: "%", ...(next > w / h ? { width: 100 } : { height: 100 }) },
          next,
          w,
          h,
        ),
        w,
        h,
      ),
    );
  };

  // The result as it will be, redrawn as the frame moves.
  useEffect(() => {
    const img = image.current;
    const canvas = preview.current;
    if (!img || !canvas || !natural) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const area = pixelsOf(crop, natural);
      const box = 256 * window.devicePixelRatio;
      const scale = Math.min(box / area.width, box / area.height, 1);
      canvas.width = Math.max(1, Math.round(area.width * scale));
      canvas.height = Math.max(1, Math.round(area.height * scale));
      const context = canvas.getContext("2d");
      context?.drawImage(
        img,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [crop, natural]);

  const replace = useMutation(api.pictures.replacePicture.mutationOptions());

  const save = async () => {
    const img = image.current;
    if (!img || !source || !natural) {
      return;
    }
    setSaving(true);
    try {
      const area = pixelsOf(crop, natural);
      const scale = Math.min(
        1,
        Math.sqrt(MAX_PIXELS / (area.width * area.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(area.width * scale);
      canvas.height = Math.round(area.height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("This browser can't draw the crop.");
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(
        img,
        area.x,
        area.y,
        area.width,
        area.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, typeFor(source.type), 0.92),
      );
      if (!blob) {
        throw new Error("This browser couldn't make the file.");
      }
      // What the browser wrote (Safari writes PNG when asked for WebP).
      const ext = EXTENSIONS[blob.type] ?? "png";
      const base = (fileName ?? "").replace(/\.[^.]*$/, "") || "picture";
      const file = new File([blob], `${base}.${ext}`, { type: blob.type });
      await replace.mutateAsync({
        bookmarkId,
        assetId: await uploadFile(file),
      });
      await Promise.all([
        queryClient.invalidateQueries(
          api.bookmarks.getBookmark.queryFilter({ bookmarkId }),
        ),
        queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter()),
        queryClient.invalidateQueries(api.pictures.pathFilter()),
      ]);
      toast({ description: "Picture cropped" });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        description:
          e instanceof Error && e.message
            ? e.message
            : "The crop couldn't be saved.",
      });
    } finally {
      setSaving(false);
    }
  };

  const size = natural ? pixelsOf(crop, natural) : null;
  const whole = crop.width >= 99.9 && crop.height >= 99.9;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex max-h-[95vh] max-w-5xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Crop</DialogTitle>
          <DialogDescription>
            Drag the frame or its edges. Saving replaces the picture for good.
            {source?.type === "image/gif" &&
              " An animated GIF becomes a still picture."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1">
          {SHAPES.map((s, i) => (
            <Button
              key={s.label}
              type="button"
              size="sm"
              variant={shape === i ? "secondary" : "ghost"}
              disabled={saving || !natural}
              onClick={() => pickShape(i)}
              className="h-8 px-3"
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-h-[12rem] items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-2">
            {failed ? (
              <p className="text-sm text-muted-foreground">
                This picture can&apos;t be opened for cropping here.
              </p>
            ) : !source ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : (
              <ReactCrop
                crop={crop}
                onChange={(_, percent) => setCrop(percent)}
                aspect={aspect}
                keepSelection
                ruleOfThirds
                minWidth={16}
                minHeight={16}
                disabled={saving}
                // Its own CSS sizes the picture from this (max-height:
                // inherit), not from the picture's classes.
                className="max-h-[60vh]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a blob, drawn onto canvases */}
                <img
                  ref={image}
                  src={source.url}
                  alt={fileName ?? ""}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNatural({
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                    setCrop(ALL);
                  }}
                  onError={() => setFailed(true)}
                  className="w-auto"
                />
              </ReactCrop>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Preview
            </p>
            <div className="flex aspect-square items-center justify-center rounded-lg bg-muted/40 p-2">
              <canvas
                ref={preview}
                className={cn(
                  "max-h-full max-w-full rounded-sm object-contain",
                  !source && "hidden",
                )}
                style={{ width: "auto", height: "auto" }}
              />
            </div>
            {size && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {size.width.toLocaleString()} × {size.height.toLocaleString()}{" "}
                px
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={saving || whole}
            onClick={() => {
              setShape(0);
              setCrop(ALL);
            }}
          >
            Reset
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !natural || whole}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
