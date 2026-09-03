import { cp, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** Shared across all three bundles. */
const common = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main/main.js",
    platform: "node",
    format: "cjs",
    // Electron and the native hook resolve at runtime from node_modules;
    // bundling either one breaks them.
    external: ["electron", "uiohook-napi"],
  },
  {
    ...common,
    entryPoints: ["src/preload/preload.ts"],
    outfile: "dist/preload/preload.js",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: ["src/renderer/overlay.ts", "src/renderer/settings.ts"],
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
  },
  {
    ...common,
    entryPoints: ["test/parse.test.ts"],
    outdir: "dist/test",
    platform: "browser",
    format: "iife",
  },
];

async function copyStatic() {
  await mkdir("dist/renderer", { recursive: true });
  for (const f of ["overlay.html", "settings.html", "style.css", "icon-dark.png", "icon-light.png"]) {
    await cp(`src/renderer/${f}`, `dist/renderer/${f}`);
  }
  await mkdir("dist/test", { recursive: true });
  await cp("test/parse.html", "dist/test/parse.html");
}

if (watch) {
  for (const cfg of builds) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  }
  await copyStatic();
  console.log("watching…");
} else {
  await Promise.all(builds.map((cfg) => esbuild.build(cfg)));
  await copyStatic();
}
