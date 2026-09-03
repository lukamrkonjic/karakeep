import type { ListNode } from "../shared/types";
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

/* ------------------------------------------------------------------ *
 * Tree
 *
 * Rows are built once and afterwards only shown or hidden, so expanding a
 * folder never replaces the element under the pointer.
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
/** True while the picker is open for a copied item, i.e. rows are clickable. */
let copyMode = false;

const CHEVRON_SVG =
  '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">' +
  '<path d="M2.6 1.2 5.6 4l-3 2.8" stroke="currentColor" stroke-width="1.3" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function setStatus(text: string): void {
  statusEl.textContent = text;
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

/** Click-to-choose: the picker is a menu now, not a drop target. */
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

async function refreshLists(): Promise<void> {
  try {
    renderTree(await api.getLists());
    setStatus("Drop into a list");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Could not load lists");
  }
}

document.addEventListener("keydown", (e) => {
  if (copyMode && e.key === "Escape") {
    copyMode = false;
    panelEl.classList.remove("copy-mode");
    api.dismissClipboard();
  }
});

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
  copyMode = false;
  panelEl.classList.remove("copy-mode");
  for (const row of rows) {
    row.el.classList.remove("over");
  }
});

void refreshLists();
