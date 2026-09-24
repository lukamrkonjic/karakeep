import { z } from "zod";

/**
 * Fork: the web app's UI preferences, kept per account (users.uiPreferences)
 * so every device shows the same — they used to live in each browser's
 * cookies and localStorage. Every key is optional: unset means the app's
 * default, and it lets a browser's older local value be copied up once.
 */
export const zUiPreferencesSchema = z.object({
  // Upstream's view options (the header's view menu) and language.
  bookmarkGridLayout: z.enum(["grid", "list", "masonry", "compact"]).optional(),
  gridColumns: z.number().int().min(1).max(6).optional(),
  showNotes: z.boolean().optional(),
  showTags: z.boolean().optional(),
  showTitle: z.boolean().optional(),
  imageFit: z.enum(["cover", "contain"]).optional(),
  lang: z.string().max(20).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  // The tailored feed's left-out lists (exclusions, so new lists join it).
  tailoredFeedExcluded: z.array(z.string()).max(5000).optional(),
  // Each page's "…" Sort, by page key (apps/web/lib/pageSort.ts).
  pageSorts: z
    .record(z.string().max(100), z.string().max(20))
    .refine((sorts) => Object.keys(sorts).length <= 500, "Too many sorts")
    .optional(),
  // Lists that show their sub-lists' items too.
  sublists: z.array(z.string()).max(5000).optional(),
  previewDetailsHidden: z.boolean().optional(),
  sidebarCollapsed: z.boolean().optional(),
  // The sidebar's lists that are unfolded (Collapse all / Expand all).
  sidebarOpenLists: z.array(z.string()).max(5000).optional(),
  // Feed videos: play on hover, and whether with sound.
  hoverVideoAutoplay: z.boolean().optional(),
  hoverVideoSound: z.boolean().optional(),
  // The "Instagram cookie expired" banner was closed for this expiry (the
  // expired session's checkedAt): it never comes back for it.
  instagramExpiryDismissed: z.string().max(40).optional(),
});

export type ZUiPreferences = z.infer<typeof zUiPreferencesSchema>;

/**
 * Stored preferences, keeping every key that is still valid — a value an
 * older or newer version wrote in another shape is dropped, not the lot.
 */
export function parseUiPreferences(raw: string | null | undefined) {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") {
    return {};
  }
  const out: Record<string, unknown> = {};
  const shape = zUiPreferencesSchema.shape;
  for (const [key, value] of Object.entries(data)) {
    const field = shape[key as keyof typeof shape];
    const parsed = field?.safeParse(value);
    if (parsed?.success && parsed.data !== undefined) {
      out[key] = parsed.data;
    }
  }
  return out as ZUiPreferences;
}
