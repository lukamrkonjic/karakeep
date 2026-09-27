/**
 * Fork: the theme's --background (tooling/tailwind/globals.css) as hex, for
 * what can't read CSS: the theme-color the browser paints its bars with — a
 * phone's status bar, the title bar of vrana added to a Mac's Dock.
 */
export const THEME_BACKGROUND = {
  // 45 33% 97.6%
  light: "#fbfaf7",
  // 40 7% 9%
  dark: "#191715",
} as const;
