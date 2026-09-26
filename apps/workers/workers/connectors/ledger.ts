import type { SubscriptionItem } from "./types";

/**
 * What a sync takes of what a source lists, going by the ledger: what this
 * subscription handled, and when.
 *
 * Anything it handled is never taken again. The rest of a carousel (an item
 * that is `partOf` another) needs "Whole carousels" on, and only comes with
 * a post first taken since it was turned on — or not taken yet. A post taken
 * before keeps what it has: its other pictures turning up now would land out
 * of place, at the top of the list.
 */
export function wantedBy(
  handled: ReadonlyMap<string, Date>,
  wholeCarouselSince: Date | null,
): (item: SubscriptionItem) => boolean {
  return (item) => {
    if (handled.has(item.externalId)) {
      return false;
    }
    if (!item.partOf) {
      return true;
    }
    if (!wholeCarouselSince) {
      return false;
    }
    const first = handled.get(item.partOf);
    return !first || first >= wholeCarouselSince;
  };
}
