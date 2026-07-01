// One-off local dev helper: seeds placeholder IMAGE bookmarks + one VIDEO
// bookmark into the running local instance so the eagle-style media tiles and
// the video player have something to render. Run against `pnpm web` on :3000.
//
//   KARAKEEP_URL=http://localhost:3000 tsx src/seed-media.ts
//
// Not part of the app; safe to delete.

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import type { AppRouter } from "@karakeep/trpc/routers/_app";

const BASE = process.env.KARAKEEP_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_EMAIL ?? "test1@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "test1234";

function makeClient(apiKey?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        transformer: superjson,
        url: `${BASE}/api/trpc`,
        headers: () => ({
          authorization: apiKey ? `Bearer ${apiKey}` : undefined,
        }),
      }),
    ],
  });
}

async function upload(
  apiKey: string,
  bytes: Uint8Array,
  fileName: string,
  type: string,
) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes as BlobPart], { type }), fileName);
  const resp = await fetch(`${BASE}/api/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!resp.ok) {
    throw new Error(
      `upload ${fileName} failed ${resp.status}: ${await resp.text()}`,
    );
  }
  return (await resp.json()) as {
    assetId: string;
    contentType: string;
    size: number;
    fileName?: string;
  };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function main() {
  console.log(`Exchanging credentials for ${EMAIL} at ${BASE} ...`);
  const key = (
    await makeClient().apiKeys.exchange.mutate({
      email: EMAIL,
      password: PASSWORD,
      keyName: `media-seed-${Date.now()}`,
    })
  ).key;
  const api = makeClient(key);

  const list = await api.lists.create.mutate({
    name: "Placeholder Gallery",
    icon: "🖼️",
  });
  console.log(`Created list ${list.name} (${list.id})`);

  // Varied aspect ratios so the masonry wall has different tile heights.
  const dims = [
    [640, 900],
    [900, 600],
    [700, 700],
    [600, 850],
    [960, 540],
    [540, 800],
    [820, 620],
    [720, 960],
  ];
  for (let i = 0; i < dims.length; i++) {
    const [w, h] = dims[i];
    const bytes = await fetchBytes(
      `https://picsum.photos/seed/kk${i}/${w}/${h}`,
    );
    const up = await upload(key, bytes, `placeholder-${i}.jpg`, "image/jpeg");
    const bm = await api.bookmarks.createBookmark.mutate({
      ...up,
      type: BookmarkTypes.ASSET,
      assetType: "image",
      source: "web",
    });
    await api.lists.addToList
      .mutate({ listId: list.id, bookmarkId: bm.id })
      .catch(() => undefined);
    console.log(`  image ${i + 1}/${dims.length} -> ${bm.id}`);
  }

  // One video bookmark: a text note with a video attachment.
  try {
    const videoBytes = await fetchBytes(
      "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    );
    const up = await upload(key, videoBytes, "sample.mp4", "video/mp4");
    const note = await api.bookmarks.createBookmark.mutate({
      type: BookmarkTypes.TEXT,
      text: "Placeholder video attachment (sample.mp4)",
      source: "web",
    });
    await api.assets.attachAsset.mutate({
      bookmarkId: note.id,
      asset: { id: up.assetId, assetType: "video" },
    });
    await api.lists.addToList
      .mutate({ listId: list.id, bookmarkId: note.id })
      .catch(() => undefined);
    console.log(`  video -> ${note.id}`);
  } catch (e) {
    console.log(`  (skipped video: ${(e as Error).message})`);
  }

  console.log("Done. Refresh the app.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
