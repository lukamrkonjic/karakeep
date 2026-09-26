/** What every subscription connector (Pinterest, Instagram) hands the worker. */

export interface SubscriptionMedia {
  kind: "image" | "video";
  url: string;
}

export interface SubscriptionItem {
  /** The source's id for this item (a pin id, an Instagram post's code). */
  externalId: string;
  /** Identifies the picture itself, so a repin of it is still one bookmark. */
  mediaKey: string | null;
  title: string | null;
  /** The item's page, which the bookmark points back to. */
  sourceUrl: string;
  /** Best first; the worker keeps the first one that downloads. */
  media: SubscriptionMedia[];
  /**
   * On the second and later pictures of a carousel (or pages of a Pinterest
   * idea pin): the first one's externalId. They follow it in `items`, and
   * are only taken with "Whole carousels" on (see ledger.ts).
   */
  partOf?: string;
}

export interface SubscriptionFetchResult {
  /** What the source calls itself, for the subscription's name. */
  name: string | null;
  /** In the source's order, top (newest) first. */
  items: SubscriptionItem[];
  /** False when paging stopped before the end of the source. */
  complete: boolean;
}
