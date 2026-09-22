export interface TSidebarItem {
  name: string;
  icon: React.ReactElement;
  path: string;
  /** Fork: e.g. the page's "…" menu, shown on hover. */
  right?: React.ReactNode;
}
