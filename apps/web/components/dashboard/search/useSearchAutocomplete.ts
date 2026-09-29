import type translation from "@/lib/i18n/locales/en/translation.json";
import { matchRank } from "@/lib/nameMatch";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Globe,
  History,
  ListTree,
  RssIcon,
  Sparkles,
  Tag as TagIcon,
} from "lucide-react";

import { useBookmarkLists } from "@karakeep/shared-react/hooks/lists";
import { useTagAutocomplete } from "@karakeep/shared-react/hooks/tags";
import { useDebounce } from "@karakeep/shared-react/hooks/use-debounce";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { zBookmarkSourceSchema } from "@karakeep/shared/types/bookmarks";

const MAX_DISPLAY_SUGGESTIONS = 5;
const NO_LISTS: string[] = [];

type SearchTranslationKey = `search.${keyof typeof translation.search}`;

interface QualifierDefinition {
  value: string;
  descriptionKey?: SearchTranslationKey;
  negatedDescriptionKey?: SearchTranslationKey;
  appendSpace?: boolean;
}

const QUALIFIER_DEFINITIONS = [
  {
    value: "is:fav",
    descriptionKey: "search.is_favorited",
    negatedDescriptionKey: "search.is_not_favorited",
    appendSpace: true,
  },
  {
    value: "is:archived",
    descriptionKey: "search.is_archived",
    negatedDescriptionKey: "search.is_not_archived",
    appendSpace: true,
  },
  {
    value: "is:tagged",
    descriptionKey: "search.has_any_tag",
    negatedDescriptionKey: "search.has_no_tags",
    appendSpace: true,
  },
  {
    value: "is:inlist",
    descriptionKey: "search.is_in_any_list",
    negatedDescriptionKey: "search.is_not_in_any_list",
    appendSpace: true,
  },
  {
    value: "is:link",
    appendSpace: true,
  },
  {
    value: "is:text",
    appendSpace: true,
  },
  {
    value: "is:media",
    appendSpace: true,
  },
  {
    value: "is:broken",
    descriptionKey: "search.is_broken_link",
    negatedDescriptionKey: "search.is_not_broken_link",
    appendSpace: true,
  },
  {
    value: "url:",
    descriptionKey: "search.url_contains",
  },
  {
    value: "title:",
    descriptionKey: "search.title_contains",
  },
  {
    value: "list:",
    descriptionKey: "search.is_in_list",
  },
  {
    value: "after:",
    descriptionKey: "search.created_on_or_after",
  },
  {
    value: "before:",
    descriptionKey: "search.created_on_or_before",
  },
  {
    value: "feed:",
    descriptionKey: "search.is_from_feed",
  },
  {
    value: "age:",
    descriptionKey: "search.created_within",
  },
  {
    value: "source:",
    descriptionKey: "search.is_from_source",
  },
] satisfies readonly QualifierDefinition[];

export interface AutocompleteSuggestionItem {
  type: "token" | "tag" | "list" | "feed" | "source" | "scope";
  id: string;
  /** Fork: a "scope" item's list (searched within, as a chip). */
  listId?: string;
  /** Fork: named after @ (what's replaced runs from the @). */
  mention?: boolean;
  label: string;
  insertText: string;
  appendSpace?: boolean;
  description?: string;
  Icon: LucideIcon;
}

export interface HistorySuggestionItem {
  type: "history";
  id: string;
  term: string;
  label: string;
  Icon: LucideIcon;
}

export type SuggestionItem = AutocompleteSuggestionItem | HistorySuggestionItem;

export interface SuggestionGroup {
  id: string;
  label: string;
  items: SuggestionItem[];
}

const stripSurroundingQuotes = (value: string) => {
  let nextValue = value;
  if (nextValue.startsWith('"')) {
    nextValue = nextValue.slice(1);
  }
  if (nextValue.endsWith('"')) {
    nextValue = nextValue.slice(0, -1);
  }
  return nextValue;
};

const shouldQuoteValue = (value: string) => /[\s:]/.test(value);

const formatSearchValue = (value: string) =>
  shouldQuoteValue(value) ? `"${value}"` : value;

interface ParsedSearchState {
  activeToken: string;
  isTokenNegative: boolean;
  tokenWithoutMinus: string;
  normalizedTokenWithoutMinus: string;
  getActiveToken: (cursorPosition: number) => { token: string; start: number };
}

interface UseSearchAutocompleteParams {
  value: string;
  onValueChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isPopoverOpen: boolean;
  setIsPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>;
  t: TFunction;
  history: string[];
  /** Fork: the lists the search is within (the chips). */
  scope?: string[];
  /** Fork: a list picked (@name), and the text without its name. */
  onScopeAdd?: (listId: string, value: string) => void;
}

const useParsedSearchState = (value: string): ParsedSearchState => {
  const getActiveToken = useCallback(
    (cursorPosition: number) => {
      let start = 0;
      let inQuotes = false;

      for (let index = 0; index < cursorPosition; index += 1) {
        const char = value[index];
        if (char === '"') {
          inQuotes = !inQuotes;
          continue;
        }

        if (!inQuotes) {
          if (char === " " || char === "\t" || char === "\n") {
            start = index + 1;
            continue;
          }

          if (char === "(") {
            start = index + 1;
          }
        }
      }

      return {
        token: value.slice(start, cursorPosition),
        start,
      };
    },
    [value],
  );

  const activeTokenInfo = useMemo(
    () => getActiveToken(value.length),
    [getActiveToken, value],
  );
  const activeToken = activeTokenInfo.token;
  const isTokenNegative = activeToken.startsWith("-");
  const tokenWithoutMinus = isTokenNegative
    ? activeToken.slice(1)
    : activeToken;
  const normalizedTokenWithoutMinus = tokenWithoutMinus.toLowerCase();

  return {
    activeToken,
    isTokenNegative,
    tokenWithoutMinus,
    normalizedTokenWithoutMinus,
    getActiveToken,
  };
};

const useQualifierSuggestions = (
  parsed: ParsedSearchState,
  t: TFunction,
): AutocompleteSuggestionItem[] => {
  const qualifierSuggestions = useMemo<AutocompleteSuggestionItem[]>(() => {
    // Don't suggest qualifiers if the user hasn't started typing
    if (parsed.normalizedTokenWithoutMinus.length === 0) {
      return [];
    }

    return QUALIFIER_DEFINITIONS.filter((definition) => {
      return definition.value
        .toLowerCase()
        .startsWith(parsed.normalizedTokenWithoutMinus);
    })
      .slice(0, MAX_DISPLAY_SUGGESTIONS)
      .map((definition) => {
        const insertText = `${parsed.isTokenNegative ? "-" : ""}${definition.value}`;
        const descriptionKey = parsed.isTokenNegative
          ? (definition.negatedDescriptionKey ?? definition.descriptionKey)
          : definition.descriptionKey;
        const description = descriptionKey ? t(descriptionKey) : undefined;

        return {
          type: "token" as const,
          id: `qualifier-${definition.value}`,
          label: insertText,
          insertText,
          appendSpace: definition.appendSpace,
          description,
          Icon: Sparkles,
        } satisfies AutocompleteSuggestionItem;
      });
  }, [parsed.normalizedTokenWithoutMinus, parsed.isTokenNegative, t]);

  return qualifierSuggestions;
};

const useTagSuggestions = (
  parsed: ParsedSearchState,
): AutocompleteSuggestionItem[] => {
  const hashed = parsed.tokenWithoutMinus.startsWith("#");
  // Fork: a word typed as it is suggests a few tags too.
  const plain = isPlainWord(parsed);
  const shouldSuggestTags = hashed || plain;
  const tagSearchTermRaw = hashed
    ? parsed.tokenWithoutMinus.slice(1)
    : plain
      ? parsed.activeToken
      : "";
  const tagSearchTerm = stripSurroundingQuotes(tagSearchTermRaw);
  const debouncedTagSearchTerm = useDebounce(tagSearchTerm, 200);

  const { data: tagResults } = useTagAutocomplete({
    nameContains: debouncedTagSearchTerm,
    select: (data) => data.tags,
    enabled: parsed.activeToken.length > 0,
  });

  const tagSuggestions = useMemo<AutocompleteSuggestionItem[]>(() => {
    if (!shouldSuggestTags) {
      return [];
    }

    // A plain word's: only where a name (or a word in it) starts with it.
    const term = tagSearchTerm.toLowerCase();
    const startsWithIt = (name: string) => {
      const rank = matchRank(name, term);
      return rank === 0 || rank === 1;
    };
    return (tagResults ?? [])
      .filter((tag) => hashed || startsWithIt(tag.name))
      .slice(0, hashed ? MAX_DISPLAY_SUGGESTIONS : MAX_WORD_SUGGESTIONS)
      .map((tag) => {
        const formattedName = formatSearchValue(tag.name);
        const insertText = `${parsed.isTokenNegative ? "-" : ""}#${formattedName}`;

        return {
          type: "tag" as const,
          id: `tag-${tag.id}`,
          label: insertText,
          insertText,
          appendSpace: true,
          description: undefined,
          Icon: TagIcon,
        } satisfies AutocompleteSuggestionItem;
      });
  }, [
    shouldSuggestTags,
    hashed,
    tagSearchTerm,
    tagResults,
    parsed.isTokenNegative,
  ]);

  return tagSuggestions;
};

const useFeedSuggestions = (
  parsed: ParsedSearchState,
): AutocompleteSuggestionItem[] => {
  const api = useTRPC();
  const shouldSuggestFeeds =
    parsed.normalizedTokenWithoutMinus.startsWith("feed:");
  const feedSearchTermRaw = shouldSuggestFeeds
    ? parsed.tokenWithoutMinus.slice("feed:".length)
    : "";
  const feedSearchTerm = stripSurroundingQuotes(feedSearchTermRaw);
  const normalizedFeedSearchTerm = feedSearchTerm.toLowerCase();
  const { data: feedResults } = useQuery(
    api.feeds.list.queryOptions(undefined, {
      enabled: parsed.activeToken.length > 0,
    }),
  );

  const feedSuggestions = useMemo<AutocompleteSuggestionItem[]>(() => {
    if (!shouldSuggestFeeds) {
      return [];
    }

    const feeds = feedResults?.feeds ?? [];

    return feeds
      .filter((feed) => {
        if (normalizedFeedSearchTerm.length === 0) {
          return true;
        }
        return feed.name.toLowerCase().includes(normalizedFeedSearchTerm);
      })
      .slice(0, MAX_DISPLAY_SUGGESTIONS)
      .map((feed) => {
        const formattedName = formatSearchValue(feed.name);
        const insertText = `${parsed.isTokenNegative ? "-" : ""}feed:${formattedName}`;
        return {
          type: "feed" as const,
          id: `feed-${feed.id}`,
          label: insertText,
          insertText,
          appendSpace: true,
          description: undefined,
          Icon: RssIcon,
        } satisfies AutocompleteSuggestionItem;
      });
  }, [
    shouldSuggestFeeds,
    feedResults,
    normalizedFeedSearchTerm,
    parsed.isTokenNegative,
  ]);

  return feedSuggestions;
};

const useListSuggestions = (
  parsed: ParsedSearchState,
): AutocompleteSuggestionItem[] => {
  const shouldSuggestLists =
    parsed.normalizedTokenWithoutMinus.startsWith("list:");
  const listSearchTermRaw = shouldSuggestLists
    ? parsed.tokenWithoutMinus.slice("list:".length)
    : "";
  const listSearchTerm = stripSurroundingQuotes(listSearchTermRaw);
  const normalizedListSearchTerm = listSearchTerm.toLowerCase();
  const { data: listResults } = useBookmarkLists(undefined, {
    enabled: parsed.activeToken.length > 0,
  });

  const listSuggestions = useMemo<AutocompleteSuggestionItem[]>(() => {
    if (!shouldSuggestLists) {
      return [];
    }

    const lists = listResults?.data ?? [];
    const seenListNames = new Set<string>();

    return lists
      .filter((list) => {
        if (normalizedListSearchTerm.length === 0) {
          return true;
        }
        return list.name.toLowerCase().includes(normalizedListSearchTerm);
      })
      .filter((list) => {
        const normalizedListName = list.name.trim().toLowerCase();
        if (seenListNames.has(normalizedListName)) {
          return false;
        }

        seenListNames.add(normalizedListName);
        return true;
      })
      .slice(0, MAX_DISPLAY_SUGGESTIONS)
      .map((list) => {
        const formattedName = formatSearchValue(list.name);
        const insertText = `${parsed.isTokenNegative ? "-" : ""}list:${formattedName}`;
        return {
          type: "list" as const,
          id: `list-${list.id}`,
          label: insertText,
          insertText,
          appendSpace: true,
          description: undefined,
          Icon: ListTree,
        } satisfies AutocompleteSuggestionItem;
      });
  }, [
    shouldSuggestLists,
    listResults,
    normalizedListSearchTerm,
    parsed.isTokenNegative,
  ]);

  return listSuggestions;
};

/**
 * Fork: a list being named after @ (spaces and all: "@interior de"), up to
 * the cursor — where its @ is and what's typed after it.
 */
export function mentionAt(
  value: string,
  cursor: number,
): { start: number; term: string } | null {
  const before = value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/[\s(]/.test(before[at - 1]))) {
    return null;
  }
  const term = before.slice(at + 1);
  return term.length <= 80 ? { start: at, term } : null;
}

/**
 * Fork: a word typed as it is (no @, #, - or qualifier:), two letters or
 * more — lists and tags are suggested for it too.
 */
const isPlainWord = (parsed: ParsedSearchState) =>
  parsed.activeToken.length >= 2 &&
  /^[^@#"(!-][^:"]*$/.test(parsed.activeToken);

/** A plain word's suggestions of each kind: a few, not to crowd the rest. */
const MAX_WORD_SUGGESTIONS = 3;

/**
 * Fork: lists to search within, each picked one a chip in the search bar.
 * @name asks for them — every list with it in its name, spaces and all; a
 * word typed as it is suggests the few whose name (or a word in it) starts
 * with it.
 */
const useScopeSuggestions = (
  value: string,
  parsed: ParsedSearchState,
  scope: string[],
): AutocompleteSuggestionItem[] => {
  const mention = useMemo(() => mentionAt(value, value.length), [value]);
  const plain = isPlainWord(parsed);
  const { data: listResults } = useBookmarkLists(undefined, {
    enabled: !!mention || plain,
  });

  return useMemo<AutocompleteSuggestionItem[]>(() => {
    if (!listResults) {
      return [];
    }
    const pick = (term: string, fromMention: boolean) =>
      listResults.data
        .filter((list) => !scope.includes(list.id))
        .map((list) => ({ list, rank: matchRank(list.name, term) }))
        .filter(({ rank }) => rank >= 0 && (fromMention || rank <= 1))
        .sort(
          (a, b) => a.rank - b.rank || a.list.name.localeCompare(b.list.name),
        )
        .slice(0, fromMention ? MAX_DISPLAY_SUGGESTIONS : MAX_WORD_SUGGESTIONS)
        .map(({ list }) => {
          const path = listResults.getPathById(list.id) ?? [];
          return {
            type: "scope" as const,
            id: `scope-${list.id}`,
            listId: list.id,
            mention: fromMention,
            label: list.name,
            insertText: "",
            description:
              path.length > 1
                ? path
                    .slice(0, -1)
                    .map((l) => l.name)
                    .join(" / ")
                : undefined,
            Icon: ListTree,
          } satisfies AutocompleteSuggestionItem;
        });
    if (mention) {
      const found = pick(mention.term.trim().toLowerCase(), true);
      // Past a space, it's still a list's name only while one has it.
      if (found.length > 0 || !/\s/.test(mention.term)) {
        return found;
      }
    }
    return plain ? pick(parsed.activeToken.toLowerCase(), false) : [];
  }, [listResults, mention, plain, parsed.activeToken, scope]);
};

const SOURCE_VALUES = zBookmarkSourceSchema.options;

const useSourceSuggestions = (
  parsed: ParsedSearchState,
): AutocompleteSuggestionItem[] => {
  const shouldSuggestSources =
    parsed.normalizedTokenWithoutMinus.startsWith("source:");
  const sourceSearchTerm = shouldSuggestSources
    ? parsed.normalizedTokenWithoutMinus.slice("source:".length)
    : "";

  const sourceSuggestions = useMemo<AutocompleteSuggestionItem[]>(() => {
    if (!shouldSuggestSources) {
      return [];
    }

    return SOURCE_VALUES.filter((source) => {
      if (sourceSearchTerm.length === 0) {
        return true;
      }
      return source.startsWith(sourceSearchTerm);
    })
      .slice(0, MAX_DISPLAY_SUGGESTIONS)
      .map((source) => {
        const insertText = `${parsed.isTokenNegative ? "-" : ""}source:${source}`;
        return {
          type: "source" as const,
          id: `source-${source}`,
          label: insertText,
          insertText,
          appendSpace: true,
          description: undefined,
          Icon: Globe,
        } satisfies AutocompleteSuggestionItem;
      });
  }, [shouldSuggestSources, sourceSearchTerm, parsed.isTokenNegative]);

  return sourceSuggestions;
};

const useHistorySuggestions = (
  value: string,
  history: string[],
): HistorySuggestionItem[] => {
  const historyItems = useMemo<HistorySuggestionItem[]>(() => {
    const trimmedValue = value.trim();
    const seenTerms = new Set<string>();
    const results =
      trimmedValue.length === 0
        ? history
        : history.filter((item) =>
            item.toLowerCase().includes(trimmedValue.toLowerCase()),
          );

    return results
      .filter((term) => {
        const normalizedTerm = term.trim().toLowerCase();
        if (seenTerms.has(normalizedTerm)) {
          return false;
        }

        seenTerms.add(normalizedTerm);
        return true;
      })
      .slice(0, MAX_DISPLAY_SUGGESTIONS)
      .map(
        (term) =>
          ({
            type: "history" as const,
            id: `history-${term}`,
            term,
            label: term,
            Icon: History,
          }) satisfies HistorySuggestionItem,
      );
  }, [history, value]);

  return historyItems;
};

export const useSearchAutocomplete = ({
  value,
  onValueChange,
  inputRef,
  isPopoverOpen,
  setIsPopoverOpen,
  t,
  history,
  scope = NO_LISTS,
  onScopeAdd,
}: UseSearchAutocompleteParams) => {
  const parsedState = useParsedSearchState(value);
  const scopeSuggestions = useScopeSuggestions(value, parsedState, scope);
  const plainWord = isPlainWord(parsedState);
  const qualifierSuggestions = useQualifierSuggestions(parsedState, t);
  const tagSuggestions = useTagSuggestions(parsedState);
  const listSuggestions = useListSuggestions(parsedState);
  const feedSuggestions = useFeedSuggestions(parsedState);
  const sourceSuggestions = useSourceSuggestions(parsedState);
  const historyItems = useHistorySuggestions(value, history);
  const { getActiveToken } = parsedState;

  const suggestionGroups = useMemo<SuggestionGroup[]>(() => {
    const groups: SuggestionGroup[] = [];

    if (scopeSuggestions.length > 0) {
      groups.push({
        id: "scope",
        label: "Search in",
        items: scopeSuggestions,
      });
    }

    if (tagSuggestions.length > 0) {
      groups.push({
        id: "tags",
        label: t("search.tags"),
        items: tagSuggestions,
      });
    }

    if (listSuggestions.length > 0) {
      groups.push({
        id: "lists",
        label: t("search.lists"),
        items: listSuggestions,
      });
    }

    if (feedSuggestions.length > 0) {
      groups.push({
        id: "feeds",
        label: t("search.feeds"),
        items: feedSuggestions,
      });
    }

    if (sourceSuggestions.length > 0) {
      groups.push({
        id: "sources",
        label: t("search.is_from_source"),
        items: sourceSuggestions,
      });
    }

    // Only suggest qualifiers if no other suggestions are available (fork:
    // or the word's typed as it is, the lists and tags for it above them)
    if ((groups.length === 0 || plainWord) && qualifierSuggestions.length > 0) {
      groups.push({
        id: "qualifiers",
        label: t("search.filters"),
        items: qualifierSuggestions,
      });
    }

    if (historyItems.length > 0) {
      groups.push({
        id: "history",
        label: t("search.history"),
        items: historyItems,
      });
    }

    return groups;
  }, [
    plainWord,
    scopeSuggestions,
    qualifierSuggestions,
    tagSuggestions,
    listSuggestions,
    feedSuggestions,
    sourceSuggestions,
    historyItems,
    t,
  ]);

  const hasSuggestions = suggestionGroups.length > 0;
  const isPopoverVisible = isPopoverOpen && hasSuggestions;
  // Fork: after @ or #, the first one's picked with Enter (a word typed as
  // it is still just searches).
  const autoSelectFirst =
    scopeSuggestions.some((item) => item.mention) ||
    (parsedState.tokenWithoutMinus.startsWith("#") &&
      tagSuggestions.length > 0);

  const handleSuggestionSelect = useCallback(
    (item: AutocompleteSuggestionItem) => {
      const input = inputRef.current;
      const selectionStart = input?.selectionStart ?? value.length;
      const selectionEnd = input?.selectionEnd ?? selectionStart;
      const { start } = getActiveToken(selectionStart);
      const beforeToken = value.slice(0, start);
      const afterToken = value.slice(selectionEnd);

      // Fork: a list becomes a chip, and its name leaves the text.
      if (item.type === "scope" && item.listId) {
        const mention = item.mention ? mentionAt(value, selectionStart) : null;
        const head = value.slice(0, mention?.start ?? start).trimEnd();
        const tail = afterToken.trimStart();
        const gap = head && tail ? " " : "";
        onScopeAdd?.(item.listId, `${head}${gap}${tail}`);
        requestAnimationFrame(() => {
          const target = inputRef.current;
          if (!target) {
            return;
          }
          const cursorPosition = head.length + gap.length;
          target.focus();
          target.setSelectionRange(cursorPosition, cursorPosition);
        });
        setIsPopoverOpen(true);
        return;
      }

      const needsSpace =
        item.appendSpace &&
        (afterToken.length === 0 || !/^\s/.test(afterToken));
      const baseValue = `${beforeToken}${item.insertText}${afterToken}`;
      const finalValue = needsSpace
        ? `${beforeToken}${item.insertText} ${afterToken}`
        : baseValue;

      onValueChange(finalValue);

      requestAnimationFrame(() => {
        const target = inputRef.current;
        if (!target) {
          return;
        }
        const cursorPosition =
          beforeToken.length + item.insertText.length + (needsSpace ? 1 : 0);
        target.focus();
        target.setSelectionRange(cursorPosition, cursorPosition);
      });

      setIsPopoverOpen(true);
    },
    [
      getActiveToken,
      onValueChange,
      onScopeAdd,
      value,
      inputRef,
      setIsPopoverOpen,
    ],
  );

  const handleCommandKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        const selectedItem = document.querySelector(
          '[cmdk-item][data-selected="true"]',
        );
        const isPlaceholderSelected =
          selectedItem?.getAttribute("data-value") === "-";
        if (!selectedItem || isPlaceholderSelected) {
          e.preventDefault();
          setIsPopoverOpen(false);
          inputRef.current?.blur();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsPopoverOpen(false);
        inputRef.current?.blur();
      }
    },
    [setIsPopoverOpen, inputRef],
  );

  return {
    suggestionGroups,
    hasSuggestions,
    isPopoverVisible,
    autoSelectFirst,
    handleSuggestionSelect,
    handleCommandKeyDown,
  };
};
