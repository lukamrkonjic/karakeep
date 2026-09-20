import { getSettings } from "./config";
import { ConnectionResult, KarakeepList } from "../shared/types";

/** What POST /api/v1/assets returns. */
interface UploadedAsset {
  assetId: string;
  contentType: string;
  size: number;
  fileName: string;
}

interface CreatedBookmark {
  id: string;
  alreadyExists?: boolean;
}

/** The asset kinds a bookmark can be built from, per the server's zod schema. */
type AssetKind = "image" | "video" | "pdf";

function base(): string {
  const { serverUrl } = getSettings();
  if (!serverUrl) {
    throw new Error("No server URL configured");
  }
  return `${serverUrl}/api/v1`;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getSettings().apiKey}` };
}

async function expectOk(res: Response, what: string): Promise<void> {
  if (res.ok) {
    return;
  }
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    detail = parsed.error ?? parsed.message ?? detail;
  } catch {
    // Not JSON — the raw text is the best detail we have.
  }
  if (res.status === 403) {
    // Almost always a scope problem rather than a wrong key: archiving needs
    // two scopes, and a key made for the old clipboard flow only has one.
    throw new Error(
      "Forbidden — this API key is missing a scope. Archiving needs both assets:readwrite and bookmarks:readwrite.",
    );
  }
  if (res.status === 401) {
    throw new Error("Unauthorized — check the API key in Settings");
  }
  throw new Error(`${what} failed (${res.status}): ${detail}`);
}

export async function testConnection(): Promise<ConnectionResult> {
  try {
    // /users/me is the cheapest call that actually exercises the API key,
    // unlike /health which is unauthenticated.
    const res = await fetch(`${base()}/users/me`, { headers: authHeaders() });
    await expectOk(res, "Connection test");
    const versionRes = await fetch(`${getSettings().serverUrl}/api/version`);
    const version = versionRes.ok
      ? ((await versionRes.json()) as { version?: string }).version
      : undefined;
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchLists(): Promise<KarakeepList[]> {
  const res = await fetch(`${base()}/lists`, { headers: authHeaders() });
  await expectOk(res, "Fetching lists");
  const body = (await res.json()) as { lists: KarakeepList[] };
  return body.lists;
}

export async function uploadAsset(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  contentType: string,
): Promise<UploadedAsset> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), fileName);

  const res = await fetch(`${base()}/assets`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  await expectOk(res, "Upload");
  return (await res.json()) as UploadedAsset;
}

export async function createAssetBookmark(args: {
  asset: UploadedAsset;
  assetType: AssetKind;
  title: string | null;
  sourceUrl: string | null;
}): Promise<CreatedBookmark> {
  const res = await fetch(`${base()}/bookmarks`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "asset",
      assetType: args.assetType,
      assetId: args.asset.assetId,
      fileName: args.asset.fileName,
      // Keeping the originating page URL is the main thing a naive uploader
      // loses versus the browser extension.
      ...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
      ...(args.title ? { title: args.title } : {}),
      source: "api",
    }),
  });
  await expectOk(res, "Creating bookmark");
  return (await res.json()) as CreatedBookmark;
}

export async function createLinkBookmark(
  url: string,
  title: string | null,
): Promise<CreatedBookmark> {
  const res = await fetch(`${base()}/bookmarks`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "link",
      url,
      ...(title ? { title } : {}),
      source: "api",
    }),
  });
  await expectOk(res, "Creating bookmark");
  return (await res.json()) as CreatedBookmark;
}

export async function addToList(
  listId: string,
  bookmarkId: string,
): Promise<void> {
  const res = await fetch(
    `${base()}/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    { method: "PUT", headers: authHeaders() },
  );
  // 409-ish "already in list" collisions aren't worth surfacing as an error.
  if (res.status === 204 || res.ok) {
    return;
  }
  await expectOk(res, "Adding to list");
}

/**
 * Sends a SingleFile capture up as a link bookmark whose archive is already
 * done — `precrawledArchiveId` on the server side.
 *
 * This is the one call the clipboard flow could never make. The server's own
 * crawler fetches a page anonymously from wherever Karakeep runs, so a
 * paywall, a login or a consent wall is all it ever sees. The bytes here came
 * out of a tab that was already past all three.
 *
 * `ifexists` defaults to "overwrite": hitting save on a page you already have
 * means the copy in front of you is the one worth keeping. "append" keeps
 * both, which is the one to reach for when a page changes over time.
 */
export async function uploadSinglefileArchive(args: {
  html: string;
  url: string;
  ifExists?: "skip" | "overwrite" | "overwrite-recrawl" | "append" | "append-recrawl";
}): Promise<CreatedBookmark> {
  const form = new FormData();
  form.append("url", args.url);
  form.append(
    "file",
    new Blob([args.html], { type: "text/html" }),
    "page.html",
  );

  const res = await fetch(
    `${base()}/bookmarks/singlefile?ifexists=${args.ifExists ?? "overwrite"}`,
    { method: "POST", headers: authHeaders(), body: form },
  );
  await expectOk(res, "Archiving page");
  return (await res.json()) as CreatedBookmark;
}

/** Creates a note bookmark — a quote lifted off a page. */
export async function createTextBookmark(
  text: string,
  sourceUrl: string | null,
  title: string | null,
): Promise<CreatedBookmark> {
  const res = await fetch(`${base()}/bookmarks`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "text",
      text,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(title ? { title } : {}),
      source: "api",
    }),
  });
  await expectOk(res, "Saving selection");
  return (await res.json()) as CreatedBookmark;
}

/** Attaches tags by name; the server creates any that don't exist yet. */
export async function addTags(
  bookmarkId: string,
  tagNames: string[],
): Promise<void> {
  if (tagNames.length === 0) {
    return;
  }
  const res = await fetch(
    `${base()}/bookmarks/${encodeURIComponent(bookmarkId)}/tags`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        tags: tagNames.map((tagName) => ({ tagName, attachedBy: "human" })),
      }),
    },
  );
  await expectOk(res, "Tagging");
}

/** A bookmark already holding this URL. */
export interface ExistingBookmark {
  id: string;
  title: string | null;
}

/**
 * Looks for something already saved under this URL.
 *
 * The search's `url:` matcher checks a link's own URL *and* an asset's
 * sourceUrl, so one call answers for a page and for a picture. The dedicated
 * /bookmarks/check-url endpoint would not: it only ever queries link
 * bookmarks, so every saved image is invisible to it.
 *
 * The match is a substring one, server side, so a URL that happens to contain
 * another will match it. For a "you already have this" prompt that errs the
 * safe way.
 */
export async function findExistingByUrl(
  url: string,
): Promise<ExistingBookmark | null> {
  if (!/^https?:/i.test(url)) {
    return null;
  }
  // Quotes delimit the value in the query language, so they cannot survive
  // inside it.
  const query = `url:"${url.replace(/"/g, "")}"`;
  const res = await fetch(
    `${base()}/bookmarks/search?q=${encodeURIComponent(query)}&limit=1`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as {
    bookmarks?: {
      id: string;
      title?: string | null;
      content?: { title?: string | null; fileName?: string | null };
    }[];
  };
  const hit = body.bookmarks?.[0];
  if (!hit) {
    return null;
  }
  return {
    id: hit.id,
    title: hit.title ?? hit.content?.title ?? hit.content?.fileName ?? null,
  };
}

/** Undo. Only ever called on a bookmark this app created seconds earlier. */
export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const res = await fetch(
    `${base()}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (res.status === 204 || res.ok) {
    return;
  }
  await expectOk(res, "Undoing");
}
