"use client";

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isEmojiIcon } from "@/lib/emoji";
import {
  queryWithinLists,
  useDoBookmarkSearch,
} from "@/lib/hooks/bookmark-search";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

import type { ZBookmarkList } from "@karakeep/shared/types/lists";
import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useSearchHistory } from "@karakeep/shared-react/hooks/search-history";
import { parseSearchQuery } from "@karakeep/shared/searchQueryParser";
import { smartRulesFromQuery } from "@karakeep/shared/smartListRules";

import { SmartListDialog } from "../lists/smart/SmartListDialog";
import QueryExplainerTooltip from "./QueryExplainerTooltip";
import { mentionAt, useSearchAutocomplete } from "./useSearchAutocomplete";

// Fork: one search, no modes — the words, what's in the pictures, colours
// (routers/pictures.ts search) — so one quiet word says it.
const PLACEHOLDER = "Search";

/** The list a page is of (/dashboard/lists/<id>), if it is. */
function listOfPage(pathname: string): string | null {
  return /^\/dashboard\/lists\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/** Fork: a list the search is within, in the search bar: "Food ×". */
function ScopeChip({
  list,
  onRemove,
}: {
  list: ZBookmarkList;
  onRemove: () => void;
}) {
  return (
    <span
      title={`Searching in ${list.name}`}
      className="mr-1.5 flex h-6 min-w-0 max-w-40 shrink items-center gap-1 rounded-md bg-background pl-2 pr-0.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-border/60"
    >
      {isEmojiIcon(list.icon) && (
        <span className="shrink-0 leading-none">{list.icon}</span>
      )}
      <span className="truncate">{list.name}</span>
      <button
        type="button"
        aria-label={`Search everywhere, not only in ${list.name}`}
        // The text keeps the focus.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function useFocusSearchOnKeyPress(
  inputRef: React.RefObject<HTMLInputElement | null>,
  value: string,
  setValue: (value: string) => void,
  setPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>,
) {
  useEffect(() => {
    function handleKeyPress(e: KeyboardEvent) {
      if (!inputRef.current) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        inputRef.current.focus();
        // Move the cursor to the end of the input field, so you can continue typing
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
        setPopoverOpen(true);
      }
      if (e.code === "Escape" && e.target == inputRef.current && value !== "") {
        e.preventDefault();
        inputRef.current.blur();
        setValue("");
      }
    }

    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [inputRef, value, setValue, setPopoverOpen]);
}

const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.HTMLAttributes<HTMLInputElement> & { loading?: boolean }
>(({ className, ...props }, ref) => {
  const { t } = useTranslation();
  const { debounceSearch, searchQuery, searchScope, doSearch, isInSearchPage } =
    useDoBookmarkSearch();
  const { addTerm, history } = useSearchHistory({
    getItem: (k: string) => localStorage.getItem(k),
    setItem: (k: string, v: string) => localStorage.setItem(k, v),
    removeItem: (k: string) => localStorage.removeItem(k),
  });

  const [value, setValue] = useState(searchQuery);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [newNestedListModalOpen, setNewNestedListModalOpen] = useState(false);

  // Fork: the lists the search is within, as chips — on the search page,
  // its own (?in=); on a list's page, that list's (× for everywhere, till
  // the next page); none elsewhere. @name adds one; with several, it's
  // within any of them.
  const pathname = usePathname();
  const onSearchPage =
    isInSearchPage || pathname.startsWith("/dashboard/search");
  const pageScope = useCallback((): string[] => {
    if (onSearchPage) {
      return searchScope;
    }
    const list = listOfPage(pathname);
    return list ? [list] : [];
  }, [onSearchPage, searchScope, pathname]);
  const [scope, setScope] = useState<string[]>(pageScope);
  // A bookmark's preview over the page isn't a page of its own.
  const scopeKey = onSearchPage
    ? `search:${searchScope.join(",")}`
    : pathname.startsWith("/dashboard/preview")
      ? null
      : `page:${pathname}`;
  const lastScopeKey = useRef(scopeKey);
  useEffect(() => {
    if (scopeKey === null || scopeKey === lastScopeKey.current) {
      return;
    }
    lastScopeKey.current = scopeKey;
    setScope(pageScope());
  }, [scopeKey, pageScope]);
  const { data: allLists } = useBookmarkLists();
  const scopeLists = useMemo(
    () =>
      scope.flatMap((id) => {
        const list = allLists?.data.find((l) => l.id === id);
        return list ? [list] : [];
      }),
    [scope, allLists],
  );
  // What's searched within: the chips' lists (not one that's gone).
  const activeScope = useMemo(
    () => (allLists ? scopeLists.map((l) => l.id) : scope),
    [allLists, scopeLists, scope],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const isHistorySelected = useRef(false);
  const isComposing = useRef(false);

  /** The chips changed: the search page follows at once. */
  const changeScope = useCallback(
    (next: string[], nextValue: string) => {
      setScope(next);
      setValue(nextValue);
      if (onSearchPage || nextValue) {
        doSearch(nextValue, next);
      }
    },
    [onSearchPage, doSearch],
  );

  const handleValueChange = useCallback(
    (newValue: string) => {
      isHistorySelected.current = false; // Reset flag when user types
      // Fork: a list being named after @ isn't searched for: its chip is
      // on its way. A list's whole name and a space makes it — unless a
      // longer name goes on from there ("@Interior " and Interior Design).
      const mention = mentionAt(newValue, newValue.length);
      const lists = allLists?.data ?? [];
      const named = mention?.term.trim().toLowerCase() ?? "";
      if (mention && named && newValue.endsWith(" ")) {
        const exact = lists.filter(
          (l) => l.name.toLowerCase() === named && !activeScope.includes(l.id),
        );
        const longer = lists.some((l) =>
          l.name.toLowerCase().startsWith(`${named} `),
        );
        if (exact.length === 1 && !longer) {
          const head = newValue.slice(0, mention.start).trimEnd();
          changeScope([...activeScope, exact[0].id], head && `${head} `);
          return;
        }
      }
      const picking =
        mention !== null &&
        (!/\s/.test(mention.term) ||
          lists.some((l) => l.name.toLowerCase().includes(named)));
      setValue(newValue);
      // Only trigger debounced search if not in IME composition mode
      if (!isComposing.current && !picking) {
        debounceSearch(newValue, activeScope);
      }
    },
    [debounceSearch, activeScope, allLists, changeScope],
  );

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposing.current = false;
      // Trigger search with the final composed value
      const target = e.target as HTMLInputElement;
      debounceSearch(target.value, activeScope);
    },
    [debounceSearch, activeScope],
  );

  const {
    suggestionGroups,
    hasSuggestions,
    isPopoverVisible,
    autoSelectFirst,
    handleSuggestionSelect,
    handleCommandKeyDown,
  } = useSearchAutocomplete({
    value,
    onValueChange: handleValueChange,
    inputRef,
    isPopoverOpen,
    setIsPopoverOpen,
    t,
    history,
    scope: activeScope,
    onScopeAdd: (listId, nextValue) =>
      changeScope([...activeScope, listId], nextValue),
  });

  const handleHistorySelect = useCallback(
    (term: string) => {
      isHistorySelected.current = true;
      setValue(term);
      doSearch(term, activeScope);
      addTerm(term);
      setIsPopoverOpen(false);
      inputRef.current?.blur();
    },
    [doSearch, addTerm, activeScope],
  );

  useFocusSearchOnKeyPress(inputRef, value, setValue, setIsPopoverOpen);
  useImperativeHandle(ref, () => inputRef.current!);

  useEffect(() => {
    if (!isInSearchPage) {
      setValue("");
    }
  }, [isInSearchPage]);

  const handleFocus = useCallback(() => {
    setIsPopoverOpen(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Only add to history if it wasn't a history selection
    if (value && !isHistorySelected.current) {
      addTerm(value);
    }

    // Reset the flag
    isHistorySelected.current = false;
    setIsPopoverOpen(false);
  }, [value, addTerm]);

  // Parse what's currently in the input rather than the query that's being
  // searched: the two diverge while typing, and when navigating away from the
  // search page the input is cleared but the last search query is kept around.
  const parsedValue = useMemo(() => parseSearchQuery(value), [value]);
  const canSaveSearch =
    parsedValue.result === "full" && parsedValue.text.length === 0;
  // Fork: saved with the lists it's within.
  const savedQuery = queryWithinLists(value, activeScope);

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      {/* Fork: saved as a smart list made of rules (the query's). */}
      <SmartListDialog
        open={newNestedListModalOpen}
        setOpen={setNewNestedListModalOpen}
        rules={canSaveSearch ? smartRulesFromQuery(savedQuery) : undefined}
      />
      <div className="absolute inset-y-0 right-1.5 z-50 flex items-center gap-1">
        {canSaveSearch ? (
          <Button
            onClick={() => setNewNestedListModalOpen(true)}
            size="none"
            variant="secondary"
            className="h-7 px-2 text-xs"
          >
            {t("actions.save")}
          </Button>
        ) : null}
        <Link
          href="https://docs.karakeep.app/Guides/search-query-language"
          target="_blank"
          className="flex size-7 shrink-0 items-center justify-center rounded-md stroke-foreground transition-colors hover:bg-background/80"
        >
          <QueryExplainerTooltip
            parsedSearchQuery={parsedValue}
            className="text-muted-foreground"
          />
        </Link>
      </div>
      <Command
        shouldFilter={false}
        // Fork: the list chips as wide as their names (up to a point), the
        // text the rest — and never less than a few words' room.
        className="relative min-w-0 rounded-md bg-transparent [&_[cmdk-input-wrapper]]:min-w-0 [&_[cmdk-input]]:min-w-[6rem] [&_[cmdk-input]]:flex-1 [&_[cmdk-input]]:basis-0"
        onKeyDown={handleCommandKeyDown}
      >
        <Popover open={isPopoverVisible}>
          <PopoverTrigger asChild>
            <div className="relative">
              <CommandInput
                ref={inputRef}
                placeholder={PLACEHOLDER}
                value={value}
                onValueChange={handleValueChange}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onFocus={handleFocus}
                onBlur={handleBlur}
                before={scopeLists.map((list) => (
                  <ScopeChip
                    key={list.id}
                    list={list}
                    onRemove={() =>
                      changeScope(
                        activeScope.filter((id) => id !== list.id),
                        value,
                      )
                    }
                  />
                ))}
                // Fork: Backspace at the start takes the last chip away.
                onKeyDown={(e) => {
                  const input = e.currentTarget;
                  if (
                    e.key === "Backspace" &&
                    scopeLists.length > 0 &&
                    input.selectionStart === 0 &&
                    input.selectionEnd === 0
                  ) {
                    e.preventDefault();
                    const last = scopeLists[scopeLists.length - 1];
                    changeScope(
                      activeScope.filter((id) => id !== last.id),
                      value,
                    );
                  }
                }}
                className={cn(
                  "h-10 pr-10 placeholder:text-muted-foreground/70",
                  canSaveSearch && "pr-24",
                  className,
                )}
                {...props}
              />
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="w-[--radix-popover-trigger-width] p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <CommandList className="max-h-96 overflow-y-auto">
              {/* Nothing picked till an arrow key (Enter searches) — but
                  after @ or #, the first (Enter takes it). */}
              {hasSuggestions && !autoSelectFirst && (
                <CommandItem value="-" className="hidden" />
              )}
              {suggestionGroups.map((group) => (
                <CommandGroup key={group.id} heading={group.label}>
                  {group.items.map((item) => {
                    if (item.type === "history") {
                      return (
                        <CommandItem
                          key={item.id}
                          value={item.label}
                          onSelect={() => handleHistorySelect(item.term)}
                          onMouseDown={() => {
                            isHistorySelected.current = true;
                          }}
                          className="cursor-pointer"
                        >
                          <item.Icon className="mr-2 h-4 w-4" />
                          <span>{item.label}</span>
                        </CommandItem>
                      );
                    }

                    return (
                      <CommandItem
                        key={item.id}
                        // A list's name can be another's too.
                        value={item.type === "scope" ? item.id : item.label}
                        onSelect={() => handleSuggestionSelect(item)}
                        className="cursor-pointer"
                      >
                        <item.Icon className="mr-2 h-4 w-4" />
                        <div className="flex flex-col">
                          <span>{item.label}</span>
                          {item.description && (
                            <span className="text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </PopoverContent>
        </Popover>
      </Command>
    </div>
  );
});
SearchInput.displayName = "SearchInput";

export { SearchInput };
