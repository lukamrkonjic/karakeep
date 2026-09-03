import { getSettings } from "./config";
import { ConnectionResult, KarakeepList, ListNode } from "../shared/types";

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

/**
 * Builds the sidebar tree: manual lists only (a smart list is a saved query,
 * so nothing can be filed into it), ordered the way the web app orders them.
 */
export function buildTree(lists: KarakeepList[]): ListNode[] {
  const fileable = lists.filter(
    (l) =>
      l.type === "manual" && (l.userRole === "owner" || l.userRole === "editor"),
  );
  const byId = new Map<string, ListNode>(
    fileable.map((l) => [l.id, { ...l, children: [] }]),
  );

  const roots: ListNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // A list whose parent we filtered out (smart, or read-only) is shown at
    // the root rather than silently dropped.
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (nodes: ListNode[]): void => {
    nodes.sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
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
