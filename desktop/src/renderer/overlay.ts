import { mergeStrings } from "../shared/dropParse";
import type { DropPayload, ListNode } from "../shared/types";
import type { KarakeepBridge } from "../preload/preload";

declare global {
  interface Window {
    karakeep: KarakeepBridge;
  }
}

const api = window.karakeep;
const panelEl = document.getElementById("panel")!;
const treeEl = document.getElementById("tree")!;
const statusEl = document.getElementById("status")!;

/** How long you have to dwell on a folder before it opens under the drag. */
const HOVER_EXPAND_MS = 300;

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

  const strings = {
    html: dt.getData("text/html"),
    uriList: dt.getData("text/uri-list"),
    mozUrl: dt.getData("text/x-moz-url"),
    plain: dt.getData("text/plain"),
  };
  const merged = mergeStrings(strings);

  // Keep the bodies for the drop log — truncated, since a text/html flavour
  // can carry a whole rendered subtree.
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(strings)) {
    if (v) {
      raw[k] = v.slice(0, 4000);
    }
  }

  const files = await Promise.all(
    fileHandles.map(async (f) => ({
      name: f.name,
      type: f.type,
      bytes: await f.arrayBuffer(),
    })),
  );

  return { files, types, raw, ...merged };
}

/* ------------------------------------------------------------------ *
 * Tree
 *
 * Every row is built once and afterwards only ever shown or hidden.
 * Re-rendering on expand would destroy the element the pointer is currently
 * over, and a drag does not survive its drop target being replaced — which
 * is exactly what makes hover-to-expand feel broken.
 * ------------------------------------------------------------------ */

interface Row {
  node: ListNode;
  /** Ids of every ancestor, so visibility is a pure function of `expanded`. */
  ancestors: string[];
  el: HTMLElement;
  chevron: HTMLElement;
}

let rows: Row[] = [];
const expanded = new Set<string>();
let hoverTimer: number | null = null;
/**
 * True when the picker was opened by a copy rather than a drag. There's no
 * drag in flight then, so rows are chosen by clicking instead of dropping.
 */
let copyMode = false;

const CHEVRON_SVG =
  '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">' +
  '<path d="M2.6 1.2 5.6 4l-3 2.8" stroke="currentColor" stroke-width="1.3" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function cancelHoverTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function makeRow(node: ListNode, depth: number, ancestors: string[]): Row {
  const el = document.createElement("div");
  el.className = "row";
  el.style.paddingLeft = `${6 + depth * 13}px`;

  const hasKids = node.children.length > 0;
  const chevron = document.createElement("span");
  chevron.className = `chev${hasKids ? "" : " chev-empty"}`;
  if (hasKids) {
    chevron.innerHTML = CHEVRON_SVG;
    chevron.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      setExpanded(node.id, !expanded.has(node.id));
    });
  }
  el.appendChild(chevron);

  // Only a real emoji earns a slot. The web app stores "??" as its
  // placeholder, and a default folder glyph on every row is exactly the
  // clutter the redesign strips out.
  if (/\p{Extended_Pictographic}/u.test(node.icon)) {
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = node.icon;
    el.appendChild(icon);
  }

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = node.name;
  el.appendChild(name);

  attachDropTarget(el, node.id, node.name, hasKids);
  attachClickTarget(el, node.id, node.name);
  return { node, ancestors, el, chevron };
}

function flatten(
  nodes: ListNode[],
  depth: number,
  ancestors: string[],
  into: Row[],
): void {
  for (const node of nodes) {
    into.push(makeRow(node, depth, ancestors));
    if (node.children.length > 0) {
      flatten(node.children, depth + 1, [...ancestors, node.id], into);
    }
  }
}

/** A row shows only when every one of its ancestors is open. */
function applyVisibility(): void {
  for (const row of rows) {
    const visible = row.ancestors.every((id) => expanded.has(id));
    row.el.classList.toggle("collapsed", !visible);
    row.chevron.classList.toggle("open", expanded.has(row.node.id));
  }
}

function setExpanded(id: string, open: boolean): void {
  if (open) {
    expanded.add(id);
  } else {
    expanded.delete(id);
  }
  applyVisibility();
}

function renderTree(tree: ListNode[]): void {
  cancelHoverTimer();
  treeEl.replaceChildren();
  rows = [];
  expanded.clear();

  const loose = document.createElement("div");
  loose.className = "row row-loose";
  const spacer = document.createElement("span");
  spacer.className = "chev chev-empty";
  loose.appendChild(spacer);
  const looseName = document.createElement("span");
  looseName.className = "name";
  looseName.textContent = "Save without a list";
  loose.appendChild(looseName);
  attachDropTarget(loose, null, null, false);
  attachClickTarget(loose, null, null);
  treeEl.appendChild(loose);

  if (tree.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No lists yet";
    treeEl.appendChild(empty);
    return;
  }

  flatten(tree, 0, [], rows);
  for (const row of rows) {
    treeEl.appendChild(row.el);
  }
  applyVisibility();
}

/* ------------------------------------------------------------------ *
 * Drop handling
 * ------------------------------------------------------------------ */

function attachDropTarget(
  el: HTMLElement,
  listId: string | null,
  listName: string | null,
  hasKids: boolean,
): void {
  el.addEventListener("dragenter", (e) => {
    e.preventDefault();
    api.diag(
      `dragenter types=[${Array.from(e.dataTransfer?.types ?? []).join(", ")}] ` +
        `items=${e.dataTransfer?.items.length ?? -1} ` +
        `files=${e.dataTransfer?.files.length ?? -1}`,
    );
    el.classList.add("over");
    cancelHoverTimer();
    if (hasKids && listId && !expanded.has(listId)) {
      // Dwelling on a folder opens it, so a subfolder is reachable without
      // letting go. Safe now that expanding only toggles classes: this very
      // element survives, so the drag keeps its target.
      hoverTimer = window.setTimeout(() => {
        setExpanded(listId, true);
        hoverTimer = null;
      }, HOVER_EXPAND_MS);
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
    cancelHoverTimer();
  });

  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("over");
    cancelHoverTimer();
    if (!e.dataTransfer) {
      api.diag("drop with NO dataTransfer at all");
      return;
    }
    api.diag(
      `drop types=[${Array.from(e.dataTransfer.types).join(", ")}] ` +
        `items=${e.dataTransfer.items.length} files=${e.dataTransfer.files.length} ` +
        `effect=${e.dataTransfer.dropEffect}/${e.dataTransfer.effectAllowed}`,
    );
    setStatus(listName ? `Saving to ${listName}…` : "Saving…");
    void (async () => {
      const payload = await extractPayload(e.dataTransfer!);
      // Some sites drag an element carrying nothing at all, so the drop
      // arrives with zero types and zero files. There is nothing to parse;
      // the only way through is to let the user paste instead.
      if (payload.types.length === 0 && payload.files.length === 0) {
        // Nothing to parse — the site attached no data at all. Main takes it
        // from here by watching for the next thing copied.
        api.dropWasEmpty({ listId, listName });
        return;
      }
      await api.ingest({ payload, listId, listName });
    })();
  });
}


/**
 * Click-to-choose, used only in copy mode. Hover feedback is applied the same
 * way the drag path marks its target, so both routes look identical.
 */
function attachClickTarget(
  el: HTMLElement,
  listId: string | null,
  listName: string | null,
): void {
  el.addEventListener("mouseenter", () => {
    if (copyMode) {
      el.classList.add("over");
    }
  });
  el.addEventListener("mouseleave", () => el.classList.remove("over"));
  el.addEventListener("click", () => {
    if (!copyMode) {
      return;
    }
    copyMode = false;
    setStatus(listName ? `Saving to ${listName}…` : "Saving…");
    void api.saveClipboard({ listId, listName });
  });
}

/* ------------------------------------------------------------------ *
 * Panel lifecycle
 * ------------------------------------------------------------------ */

// Wheel-free scrolling: nudge the list when the pointer nears an edge, since
// the scroll wheel is unavailable while a drag is in flight.
treeEl.addEventListener("dragover", (e) => {
  const box = treeEl.getBoundingClientRect();
  const margin = 26;
  if (e.clientY < box.top + margin) {
    treeEl.scrollTop -= 14;
  } else if (e.clientY > box.bottom - margin) {
    treeEl.scrollTop += 14;
  }
});

async function refreshLists(): Promise<void> {
  try {
    renderTree(await api.getLists());
    setStatus("Drop into a list");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Could not load lists");
  }
}

api.onCopyMode((kind) => {
  copyMode = true;
  panelEl.classList.add("copy-mode");
  setStatus(kind === "image" ? "Save copied image to…" : "Save copied link to…");
});

api.onOverlayShow(() => {
  copyMode = false;
  panelEl.classList.remove("copy-mode");
  setStatus("Drop into a list");
  // Start compact every time: most-recently-used sorts to the top, so the
  // common case is one flick with nothing expanded.
  expanded.clear();
  applyVisibility();
  treeEl.scrollTop = 0;
  void refreshLists();
});

api.onOverlayHide(() => {
  cancelHoverTimer();
  copyMode = false;
  panelEl.classList.remove("copy-mode");
  for (const row of rows) {
    row.el.classList.remove("over");
  }
});

void refreshLists();
