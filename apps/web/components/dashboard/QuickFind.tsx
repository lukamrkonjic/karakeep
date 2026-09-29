"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useSession } from "@/lib/auth/client";
import { isEmojiIcon } from "@/lib/emoji";
import { buildSearchHref } from "@/lib/hooks/bookmark-search";
import { useTranslation } from "@/lib/i18n/client";
import { matchRank } from "@/lib/nameMatch";
import { getOS } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Clock,
  Compass,
  Hash,
  Highlighter,
  Home,
  List,
  ListFilter,
  Newspaper,
  Paintbrush,
  Search,
  Settings,
  Shield,
  Star,
  Tag,
} from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useSearchHistory } from "@karakeep/shared-react/hooks/search-history";
import { useTagAutocomplete } from "@karakeep/shared-react/hooks/tags";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";

/** Somewhere Quick find goes (a list, a tag, a page), as remembered. */
interface Place {
  kind: "list" | "tag" | "page";
  id: string;
  name: string;
  href: string;
}

/** The last few places gone to from here, on this device. */
const RECENT_KEY = "quickFind.recent";
const RECENT_MAX = 6;

function readRecent(): Place[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "");
    return Array.isArray(stored)
      ? (stored as Place[])
          .filter((p) => p && typeof p.href === "string")
          .slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function remember(place: Place) {
  try {
    const rest = readRecent().filter(
      (p) => !(p.kind === place.kind && p.id === place.id),
    );
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([place, ...rest].slice(0, RECENT_MAX)),
    );
  } catch {
    // Private browsing: it just isn't remembered.
  }
}

/** The list a page is of (/dashboard/lists/<id>), if it is. */
function listOfPage(pathname: string): string | null {
  return /^\/dashboard\/lists\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/** What's typed, bold where it is in a name. */
function Marked({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term) : -1;
  if (at < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-foreground">
        {text.slice(at, at + term.length)}
      </span>
      {text.slice(at + term.length)}
    </>
  );
}

function ListIcon({ list }: { list: ZBookmarkList }) {
  if (isEmojiIcon(list.icon)) {
    return (
      <span className="flex size-4 items-center justify-center text-base leading-none">
        {list.icon}
      </span>
    );
  }
  return list.type === "smart" ? <ListFilter /> : <List />;
}

function Row({
  icon,
  children,
  hint,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && (
        <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
          {hint}
        </span>
      )}
    </>
  );
}

const ITEM = "gap-3 rounded-md px-3 py-2";

/**
 * Fork: Quick find — ⌘F on a Mac, Ctrl+F elsewhere (instead of the
 * browser's find), as Notion's search: a box over the page. Enter searches
 * what's typed (on a list's page, within that list; "everywhere" is at the
 * end). Under it, the lists, tags and pages whose name — or a word in it —
 * starts with it (then those that have it anywhere): ↓ to one and Enter
 * goes there. @name looks among lists only and #name among tags, the first
 * picked with Enter, as in the search bar. Empty, it shows where you last
 * went from here and the pages.
 */
export default function QuickFind() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [recent, setRecent] = useState<Place[]>([]);
  // Gone somewhere: the focus stays with the new page, not back where it was.
  const leaving = useRef(false);
  const { addTerm, history } = useSearchHistory({
    getItem: (k: string) => localStorage.getItem(k),
    setItem: (k: string, v: string) => localStorage.setItem(k, v),
    removeItem: (k: string) => localStorage.removeItem(k),
  });

  useEffect(() => {
    const mac = getOS() === "macos";
    const onKey = (e: KeyboardEvent) => {
      const held = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (held && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (!e.repeat) {
          setOpen((was) => !was);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Each time: an empty box, and where you last went.
  useEffect(() => {
    if (open) {
      setTyped("");
      setRecent(readRecent());
      leaving.current = false;
    }
  }, [open]);

  const only = typed.startsWith("@")
    ? "lists"
    : typed.startsWith("#")
      ? "tags"
      : null;
  const term = (only ? typed.slice(1) : typed).trim().toLowerCase();
  const tagTerm = useDebounce(term, 150);

  const { data: lists } = useBookmarkLists(undefined, { enabled: open });
  const { data: tags } = useTagAutocomplete({
    nameContains: tagTerm,
    select: (data) => data.tags,
    enabled: open && only !== "lists" && tagTerm.length > 0,
  });

  const pages = useMemo(() => {
    const all: {
      id: string;
      name: string;
      href: string;
      icon: LucideIcon;
      also?: string[];
    }[] = [
      {
        id: "home",
        name: t("common.home"),
        href: "/dashboard/bookmarks",
        icon: Home,
      },
      {
        id: "feed",
        name: "Tailored feed",
        href: "/dashboard/feed",
        icon: Newspaper,
      },
      {
        id: "discover",
        name: "Discover",
        href: "/dashboard/discover",
        icon: Compass,
      },
      {
        id: "tags",
        name: t("common.tags"),
        href: "/dashboard/tags",
        icon: Tag,
      },
      {
        id: "favourites",
        name: t("lists.favourites"),
        href: "/dashboard/favourites",
        icon: Star,
        also: ["starred", "favorites"],
      },
      {
        id: "archive",
        name: t("common.archive"),
        href: "/dashboard/archive",
        icon: Archive,
      },
      {
        id: "highlights",
        name: t("common.highlights"),
        href: "/dashboard/highlights",
        icon: Highlighter,
      },
      {
        id: "cleanups",
        name: t("cleanups.cleanups"),
        href: "/dashboard/cleanups",
        icon: Paintbrush,
        also: ["duplicates", "suggestions"],
      },
      {
        id: "settings",
        name: t("settings.user_settings"),
        href: "/settings",
        icon: Settings,
        also: ["settings", "preferences"],
      },
      {
        id: "settings-pictures",
        name: "Settings: Pictures",
        href: "/settings/pictures",
        icon: Settings,
        also: ["pictures", "colours", "similar"],
      },
      {
        id: "settings-subscriptions",
        name: "Settings: List subscriptions",
        href: "/settings/list-subscriptions",
        icon: Settings,
        also: ["subscriptions", "pinterest", "instagram", "youtube"],
      },
      {
        id: "settings-import",
        name: "Settings: Import",
        href: "/settings/import",
        icon: Settings,
        also: ["import", "export"],
      },
    ];
    if (session?.user.role === "admin") {
      all.push({
        id: "admin",
        name: t("admin.admin_settings"),
        href: "/admin",
        icon: Shield,
        also: ["admin", "jobs"],
      });
    }
    return all;
  }, [t, session?.user.role]);

  const byId = useMemo(
    () => new Map((lists?.data ?? []).map((l) => [l.id, l])),
    [lists],
  );
  const pathOf = (id: string) =>
    (lists?.getPathById(id) ?? [])
      .slice(0, -1)
      .map((l) => l.name)
      .join(" / ");

  const foundLists = useMemo(() => {
    if (!lists || only === "tags" || (!term && !only)) {
      return [];
    }
    return lists.data
      .map((list) => ({ list, rank: matchRank(list.name, term) }))
      .filter(({ rank }) => rank >= 0)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.list.name.length - b.list.name.length ||
          a.list.name.localeCompare(b.list.name),
      )
      .slice(0, only ? 12 : 7)
      .map(({ list }) => list);
  }, [lists, term, only]);

  const foundTags = useMemo(() => {
    if (!tags || only === "lists" || !term) {
      return [];
    }
    return tags
      .map((tag) => ({ tag, rank: matchRank(tag.name, term) }))
      .filter(({ rank }) => rank >= 0)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.tag.name.length - b.tag.name.length ||
          a.tag.name.localeCompare(b.tag.name),
      )
      .slice(0, only ? 12 : 4)
      .map(({ tag }) => tag);
  }, [tags, term, only]);

  const foundPages = useMemo(() => {
    if (only) {
      return [];
    }
    if (!term) {
      return pages;
    }
    return pages
      .map((page) => ({
        page,
        rank: Math.min(
          ...[page.name, ...(page.also ?? [])]
            .map((name) => matchRank(name, term))
            .map((rank) => (rank < 0 ? 9 : rank)),
        ),
      }))
      .filter(({ rank }) => rank <= 1)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 4)
      .map(({ page }) => page);
  }, [pages, term, only]);

  const pastSearches = useMemo(() => {
    if (only || !term) {
      return [];
    }
    return history
      .filter((h) => h.toLowerCase().includes(term) && h.trim() !== term)
      .slice(0, 3);
  }, [history, term, only]);

  const go = (href: string, place?: Place) => {
    if (place) {
      remember(place);
    }
    leaving.current = true;
    setOpen(false);
    router.push(href);
  };
  const search = (text: string, listIds: string[] = []) => {
    void addTerm(text);
    go(buildSearchHref(text, listIds));
  };

  const pageList = listOfPage(pathname);
  const here = pageList ? byId.get(pageList) : undefined;
  const query = typed.trim();
  const shownRecent = recent.flatMap((place) => {
    if (place.kind !== "list") {
      return [place];
    }
    // As it's called now; not one that's gone.
    const list = byId.get(place.id);
    return list ? [{ ...place, name: list.name }] : [];
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideCloseBtn
        overlayClassName="bg-black/50"
        // Near the top, as Notion's: what's under it grows downwards.
        className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(e) => leaving.current && e.preventDefault()}
      >
        <DialogTitle className="sr-only">Quick find</DialogTitle>
        <DialogDescription className="sr-only">
          Search, or go to a list, tag or page.
        </DialogDescription>
        <Command
          shouldFilter={false}
          loop
          className="rounded-lg [&_[cmdk-group-heading]]:px-3"
        >
          <CommandInput
            value={typed}
            onValueChange={setTyped}
            placeholder="Search, or go to a list, tag or page…"
            className="h-12 text-base"
          />
          <CommandList className="max-h-[min(60vh,30rem)] border-t pb-1">
            {query && !only && (
              <CommandGroup>
                {here ? (
                  <CommandItem
                    value="search-here"
                    className={ITEM}
                    onSelect={() => search(query, [here.id])}
                  >
                    <Row icon={<Search />}>
                      Search “{query}” in {here.name}
                    </Row>
                  </CommandItem>
                ) : (
                  <CommandItem
                    value="search"
                    className={ITEM}
                    onSelect={() => search(query)}
                  >
                    <Row icon={<Search />}>Search “{query}”</Row>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {!query && shownRecent.length > 0 && (
              <CommandGroup heading="Recent">
                {shownRecent.map((place) => (
                  <CommandItem
                    key={`${place.kind}-${place.id}`}
                    value={`recent-${place.kind}-${place.id}`}
                    className={ITEM}
                    onSelect={() => go(place.href, place)}
                  >
                    <Row
                      icon={
                        place.kind === "list" && byId.get(place.id) ? (
                          <ListIcon list={byId.get(place.id)!} />
                        ) : place.kind === "tag" ? (
                          <Hash />
                        ) : (
                          <Clock />
                        )
                      }
                      hint={place.kind === "list" ? pathOf(place.id) : ""}
                    >
                      {place.name}
                    </Row>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {foundLists.length > 0 && (
              <CommandGroup heading="Lists">
                {foundLists.map((list) => (
                  <CommandItem
                    key={list.id}
                    value={`list-${list.id}`}
                    className={ITEM}
                    onSelect={() =>
                      go(`/dashboard/lists/${list.id}`, {
                        kind: "list",
                        id: list.id,
                        name: list.name,
                        href: `/dashboard/lists/${list.id}`,
                      })
                    }
                  >
                    <Row icon={<ListIcon list={list} />} hint={pathOf(list.id)}>
                      <Marked text={list.name} term={term} />
                    </Row>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {foundTags.length > 0 && (
              <CommandGroup heading="Tags">
                {foundTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={`tag-${tag.id}`}
                    className={ITEM}
                    onSelect={() =>
                      go(`/dashboard/tags/${tag.id}`, {
                        kind: "tag",
                        id: tag.id,
                        name: tag.name,
                        href: `/dashboard/tags/${tag.id}`,
                      })
                    }
                  >
                    <Row
                      icon={<Hash />}
                      hint={
                        tag.numBookmarks > 0 ? String(tag.numBookmarks) : ""
                      }
                    >
                      <Marked text={tag.name} term={term} />
                    </Row>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {foundPages.length > 0 && (
              <CommandGroup heading="Pages">
                {foundPages.map((page) => (
                  <CommandItem
                    key={page.id}
                    value={`page-${page.id}`}
                    className={ITEM}
                    onSelect={() =>
                      go(page.href, {
                        kind: "page",
                        id: page.id,
                        name: page.name,
                        href: page.href,
                      })
                    }
                  >
                    <Row icon={<page.icon />}>
                      <Marked text={page.name} term={term} />
                    </Row>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {pastSearches.length > 0 && (
              <CommandGroup heading="Recent searches">
                {pastSearches.map((past) => (
                  <CommandItem
                    key={past}
                    value={`past-${past}`}
                    className={ITEM}
                    onSelect={() => search(past)}
                  >
                    <Row icon={<Clock />}>
                      <Marked text={past} term={term} />
                    </Row>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query && !only && here && (
              <CommandGroup>
                <CommandItem
                  value="search-everywhere"
                  className={ITEM}
                  onSelect={() => search(query)}
                >
                  <Row icon={<Search />}>Search “{query}” everywhere</Row>
                </CommandItem>
              </CommandGroup>
            )}
            {only && foundLists.length === 0 && foundTags.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {only === "lists" ? "No list" : "No tag"} called “{term}”
              </p>
            )}
          </CommandList>
          <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> to open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> to close
            </span>
            <span className="ml-auto hidden sm:inline">@ lists · # tags</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
