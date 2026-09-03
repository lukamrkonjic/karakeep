import { mergeStrings } from "../shared/dropParse";
import type { DropPayload, ListNode } from "../shared/types";
import type { KarakeepBridge } from "../preload/preload";

declare global {
  interface Window {
    karakeep: KarakeepBridge;
  }
}

const api = window.karakeep;
const treeEl = document.getElementById("tree")!;
const statusEl = document.getElementById("status")!;

let tree: ListNode[] = [];
const expanded = new Set<string>();

/* ------------------------------------------------------------------ *
 * Payload extraction
 * ------------------------------------------------------------------ */

/**
 * Reads everything useful out of a DataTransfer.
 *
 * getData() is only valid synchronously inside the event, so every string is
 * pulled first and only the File bodies are awaited afterwards (File handles
 * stay valid once captured).
 */
async function extractPayload(dt: DataTransfer): Promise<DropPayload> {
  const types = Array.from(dt.types);
  const fileHandles = Array.from(dt.files);

  const merged = mergeStrings({
    html: dt.getData("text/html"),
    uriList: dt.getData("text/uri-list"),
    mozUrl: dt.getData("text/x-moz-url"),
    plain: dt.getData("text/plain"),
  });

  const files = await Promise.all(
    fileHandles.map(async (f) => ({
      name: f.name,
      type: f.type,
      bytes: await f.arrayBuffer(),
    })),
  );

  return { files, types, ...merged };
}

/* ------------------------------------------------------------------ *
 * Tree rendering
 * ------------------------------------------------------------------ */

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function renderRows(nodes: ListNode[], depth: number, into: HTMLElement): void {
  for (const node of nodes) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.listId = node.id;

    const hasKids = node.children.length > 0;
    const chevron = document.createElement("span");
    chevron.className = `chev${hasKids ? "" : " chev-empty"}`;
    chevron.textContent = hasKids ? (expanded.has(node.id) ? "▾" : "▸") : "";
    chevron.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      toggle(node.id);
    });
    row.appendChild(chevron);

    const icon = document.createElement("span");
    icon.className = "icon";
    // The web app stores "??" for lists with no real emoji; hide that here too.
    icon.textContent = /\p{Extended_Pictographic}/u.test(node.icon)
      ? node.icon
      : "📁";
    row.appendChild(icon);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = node.name;
    row.appendChild(name);

    attachDropTarget(row, node.id, node.name, hasKids);
    into.appendChild(row);

    if (hasKids && expanded.has(node.id)) {
      renderRows(node.children, depth + 1, into);
    }
  }
}

function toggle(id: string): void {
  if (expanded.has(id)) {
    expanded.delete(id);
  } else {
    expanded.add(id);
  }
  render();
}

function render(): void {
  treeEl.replaceChildren();

  const loose = document.createElement("div");
  loose.className = "row row-loose";
  loose.innerHTML = `<span class="chev chev-empty"></span><span class="icon">📥</span><span class="name">Save without a list</span>`;
  attachDropTarget(loose, null, null, false);
  treeEl.appendChild(loose);

  if (tree.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No lists yet";
    treeEl.appendChild(empty);
    return;
  }
  renderRows(tree, 0, treeEl);
}

/* ------------------------------------------------------------------ *
 * Drop handling
 * ------------------------------------------------------------------ */

let hoverExpandTimer: number | null = null;

function attachDropTarget(
  el: HTMLElement,
  listId: string | null,
  listName: string | null,
  hasKids: boolean,
): void {
  el.addEventListener("dragenter", (e) => {
    e.preventDefault();
    el.classList.add("over");
    if (hasKids && listId && !expanded.has(listId)) {
      // Hovering a collapsed folder opens it, so you can dig into a subtree
      // without letting go of the drag.
      hoverExpandTimer = window.setTimeout(() => toggle(listId), 450);
    }
  });

  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  });

  el.addEventListener("dragleave", () => {
    el.classList.remove("over");
    if (hoverExpandTimer !== null) {
      clearTimeout(hoverExpandTimer);
      hoverExpandTimer = null;
    }
  });

  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("over");
    if (!e.dataTransfer) {
      return;
    }
    setStatus(listName ? `Saving to ${listName}…` : "Saving…");
    void (async () => {
      const payload = await extractPayload(e.dataTransfer!);
      await api.ingest({ payload, listId, listName });
    })();
  });
}

/* ------------------------------------------------------------------ *
 * Panel lifecycle
 * ------------------------------------------------------------------ */

// Wheel-free scrolling: nudge the list when the pointer nears an edge, since
// the scroll wheel is unavailable while a drag is in flight.
treeEl.addEventListener("dragover", (e) => {
  const box = treeEl.getBoundingClientRect();
  const margin = 28;
  if (e.clientY < box.top + margin) {
    treeEl.scrollTop -= 12;
  } else if (e.clientY > box.bottom - margin) {
    treeEl.scrollTop += 12;
  }
});

async function refreshLists(): Promise<void> {
  try {
    tree = await api.getLists();
    render();
    setStatus("Drop into a list");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Could not load lists");
  }
}

api.onOverlayShow(() => {
  setStatus("Drop into a list");
  void refreshLists();
});

api.onOverlayHide(() => {
  if (hoverExpandTimer !== null) {
    clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
  }
});

render();
void refreshLists();
