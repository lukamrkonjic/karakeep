"use client";

import { toast } from "@/components/ui/sonner";
import { isEmojiIcon } from "@/lib/emoji";
import { useQuery } from "@tanstack/react-query";
import { Folder, Plus, X } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { useAcceptSuggestions, useDismissSuggestions } from "./pictures";

/**
 * Fork: "Belongs in…" in a picture's details, under its lists — the lists
 * its closest matches are in (the suggestions job, Settings → Pictures): a
 * click adds it, the x says not that one.
 */
export function ListSuggestionChips({ bookmarkId }: { bookmarkId: string }) {
  const api = useTRPC();
  const { data: suggestions } = useQuery(
    api.pictures.suggestionsFor.queryOptions({ bookmarkId }),
  );
  const onError = (message: string) =>
    toast({ variant: "destructive", description: message });
  const { mutate: accept } = useAcceptSuggestions(onError);
  const { mutate: dismiss } = useDismissSuggestions(onError);

  if (!suggestions || suggestions.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="pr-0.5 text-xs text-muted-foreground">Belongs in</span>
      {suggestions.map((suggestion) => (
        <span
          key={suggestion.id}
          className="flex max-w-full items-center rounded-md border border-dashed border-primary/50 text-xs text-foreground"
        >
          <button
            type="button"
            onClick={() => accept({ ids: [suggestion.id] })}
            title={`Add to ${suggestion.name} (${Math.round(suggestion.score * 100)}% of its closest matches are there)`}
            className="flex min-w-0 items-center gap-1.5 py-1.5 pl-2 pr-1 hover:text-primary"
          >
            <Plus className="size-3 shrink-0 text-primary" />
            {isEmojiIcon(suggestion.icon) ? (
              <span>{suggestion.icon}</span>
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{suggestion.name}</span>
          </button>
          <button
            type="button"
            onClick={() => dismiss({ ids: [suggestion.id] })}
            aria-label={`Not ${suggestion.name}`}
            title="Not this list"
            className="mr-1 flex rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
