import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import animate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";

import base from "./base";

export default {
  content: base.content,
  presets: [base],
  // Fork: hover styles (hover:, group-hover:, peer-hover:) only where there
  // is a real hover, a mouse or a trackpad: Tailwind puts them in
  // @media (hover: hover) and (pointer: fine). A tap on a phone "hovers"
  // too, and when that reveals something clickable (a picture's title and
  // buttons, a shared card's owner) iOS takes the tap for the hover and
  // drops the click, so it took a second tap to open anything.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-border": {
          "0%, 100%": {
            "box-shadow": "0 0 0 0 gray",
          },
          "50%": {
            "box-shadow": "0 0 0 2px gray",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-border": "pulse-border 1s ease-in-out infinite",
      },
    },
  },
  plugins: [
    animate,
    typography,
    // Fork: `touch:` is every other device (phones, tablets): the exact
    // opposite of the hover above. What a hover reveals is either always
    // there by touch or not there at all: see-through, it would still take
    // the tap.
    plugin(({ addVariant }) => {
      addVariant(
        "touch",
        "@media not all and (hover: hover) and (pointer: fine)",
      );
      // Fork: `mac-app:` is vrana's Mac app (apps/desktop), whose window
      // buttons sit in the page's top-left corner — the app marks <html>
      // with data-shell="macos"; full screen hides them.
      addVariant(
        "mac-app",
        'html[data-shell="macos"]:not([data-fullscreen]) &',
      );
    }),
  ],
} satisfies Config;
