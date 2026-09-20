import type { MagpieDropBridge } from "../preload/dropzonePreload";
import type { DropPanelState, PickerList, PickerNode } from "../shared/types";

declare global {
  interface Window {
    magpieDrop: MagpieDropBridge;
  }
}

const bridge = window.magpieDrop;

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const scrim = $<HTMLDivElement>("scrim");
const panel = $<HTMLDivElement>("panel");
const filing = $<HTMLDivElement>("filing");
const explorer = $<HTMLDivElement>("search");
const recents = $<HTMLDivElement>("recents");
const results = $<HTMLDivElement>("results");
const query = $<HTMLInputElement>("query");
const thumb = $<HTMLImageElement>("thumb");
const hint = $<HTMLDivElement>("hint");

let all: PickerList[] = [];
let tree: PickerNode[] = [];
/** Folders the user has opened in the explorer, kept across re-renders. */
const opened = new Set<string>();

function file(id: string, name: string): void {
  bridge.drop({ kind: "list", id, name });
}

/* ---------------- a row ---------------- */

interface RowOptions {
  name: string;
  /** A Karakeep list icon, which is an emoji, or empty. */
  icon?: string;
  /** Ancestry, shown only when a search result needs disambiguating. */
  path?: string;
  depth?: number;
  onPick: () => void;
  /** Present on a folder that has children; toggles instead of filing. */
  onToggle?: () => void;
  open?: boolean;
}

function row(o: RowOptions): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "drop-row";
  if (o.depth) {
    el.style.paddingLeft = `${11 + o.depth * 15}px`;
  }

  const chev = document.createElement("span");
  chev.className = "drop-chev" + (o.open ? " open" : "");
  if (o.onToggle) {
    chev.textContent = "›";
    chev.addEventListener("click", (e) => {
      // Opening a folder is not the same as filing into it.
      e.stopPropagation();
      o.onToggle?.();
    });
  }
  el.append(chev);

  if (o.icon) {
    const icon = document.createElement("span");
    icon.className = "drop-row-icon";
    icon.textContent = o.icon;
    el.append(icon);
  }

  const name = document.createElement("span");
  name.className = "drop-row-name";
  name.textContent = o.name;
  el.append(name);

  if (o.path) {
    const path = document.createElement("span");
    path.className = "drop-row-path";
    path.textContent = o.path;
    el.append(path);
  }

  // Both a drop target and a button: used mid-drag in the filing view, and by
  // click or Enter once the drag is over.
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    o.onPick();
  });
  el.addEventListener("click", o.onPick);

  return el;
}

/* ---------------- filing view ---------------- */

function showFiling(state: DropPanelState): void {
  panel.classList.remove("explore");
  filing.hidden = false;
  explorer.hidden = true;
  // A frame between "laid out" and "visible", or the transition has nothing
  // to move from and the card simply appears.
  requestAnimationFrame(() => scrim.classList.add("in"));
  query.value = "";
  opened.clear();

  all = state.all;
  tree = state.tree;

  // A blob: URL belongs to the page that made it and cannot be shown here.
  if (state.payload.src && !state.payload.src.startsWith("blob:")) {
    thumb.src = state.payload.src;
    thumb.hidden = false;
  } else {
    thumb.hidden = true;
  }

  renderRecents(state.recent);
}

function renderRecents(recent: PickerList[]): void {
  recents.replaceChildren();
  if (recent.length === 0) {
    const empty = document.createElement("div");
    empty.className = "drop-empty";
    empty.textContent =
      "No lists used yet. Drop on the left to keep it loose, or choose a list below.";
    recents.append(empty);
  }
  for (const list of recent) {
    recents.append(
      row({
        name: list.name,
        path: list.path,
        onPick: () => file(list.id, list.name),
      }),
    );
  }
}

/* ---------------- explorer ---------------- */

function renderTree(nodes: PickerNode[], depth: number, into: HTMLElement): void {
  for (const node of nodes) {
    const isOpen = opened.has(node.id);
    const hasKids = node.children.length > 0;
    into.append(
      row({
        name: node.name,
        icon: node.icon,
        depth,
        open: isOpen,
        onPick: () => file(node.id, node.name),
        onToggle: hasKids
          ? () => {
              if (isOpen) {
                opened.delete(node.id);
              } else {
                opened.add(node.id);
              }
              renderExplorer();
            }
          : undefined,
      }),
    );
    if (hasKids && isOpen) {
      renderTree(node.children, depth + 1, into);
    }
  }
}

function renderExplorer(): void {
  const q = query.value.trim().toLowerCase();
  results.replaceChildren();

  if (!q) {
    // No query: browse the whole tree the way the sidebar shows it.
    hint.textContent = "Click a list to file it · Esc cancels";
    if (tree.length === 0) {
      const empty = document.createElement("div");
      empty.className = "drop-empty";
      empty.textContent = "No lists on the server yet.";
      results.append(empty);
      return;
    }
    renderTree(tree, 0, results);
    return;
  }

  hint.textContent = "Enter files into the top match · Esc cancels";
  const matches = all
    .filter(
      (l) =>
        l.name.toLowerCase().includes(q) || l.path.toLowerCase().includes(q),
    )
    .slice(0, 80);

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "drop-empty";
    empty.textContent = "Nothing matches that.";
    results.append(empty);
    return;
  }
  for (const list of matches) {
    results.append(
      row({
        name: list.name,
        path: list.path,
        onPick: () => file(list.id, list.name),
      }),
    );
  }
}

function showExplorer(): void {
  panel.classList.add("explore");
  filing.hidden = true;
  explorer.hidden = false;
  // Open the top level, so the modal never arrives looking empty.
  for (const node of tree.slice(0, 1)) {
    opened.add(node.id);
  }
  renderExplorer();
  bridge.explore();
  query.focus();
}

query.addEventListener("input", renderExplorer);
query.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    (results.querySelector(".drop-row") as HTMLElement | null)?.click();
  } else if (e.key === "Escape") {
    bridge.cancel();
  }
});

/* ---------------- zones ---------------- */

function zone(id: string, onDrop: () => void): void {
  const el = $(id);
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("over");
    onDrop();
  });
  el.addEventListener("click", onDrop);
}

zone("zone-unsorted", () => bridge.drop({ kind: "unsorted" }));

// Dropping here files nothing. It hands over to the explorer, which only
// becomes usable once the drag has ended and the keyboard is free again.
zone("zone-choose", () => {
  bridge.drop({ kind: "choose" });
  showExplorer();
});

// Otherwise a stray drop would make this page navigate to the dragged image.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    bridge.cancel();
  }
});

bridge.onShow(showFiling);

// The panel is drawn before the server has answered, so the lists it offers
// are filled in when they arrive rather than held back.
bridge.onLists((lists) => {
  all = lists.all;
  tree = lists.tree;
  if (!filing.hidden) {
    renderRecents(lists.recent);
  } else {
    renderExplorer();
  }
});

// Main takes the view away once this has had time to run.
bridge.onHide(() => scrim.classList.remove("in"));

// Clicking the dimmed area is the ordinary way out of a modal. Guarded on the
// target so a click inside the card does not count.
scrim.addEventListener("mousedown", (e) => {
  if (e.target === scrim) {
    bridge.cancel();
  }
});
