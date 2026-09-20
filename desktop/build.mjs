import { access, copyFile, cp, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

// The baked connection details are deliberately untracked, so a fresh clone
// has no copy of them. An empty one keeps the build working; Settings then
// asks for a server and a key the way it always did.
try {
  await access("src/shared/defaults.ts");
} catch {
  await copyFile("src/shared/defaults.example.ts", "src/shared/defaults.ts");
  console.log("created src/shared/defaults.ts from the example");
}

const watch = process.argv.includes("--watch");

/** Shared across all bundles. */
const common = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
};

/**
 * The adblocker resolves its own cosmetic-filtering preload with
 * `require.resolve`, which only answers correctly when the package is still a
 * package at runtime. Bundling it would rewrite that call and leave the
 * blocker unable to find its own preload, so it stays external.
 */
const mainExternal = [
  "electron",
  "@ghostery/adblocker-electron",
  "@ghostery/adblocker-electron-preload",
];

const builds = [
  {
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main/main.js",
    platform: "node",
    format: "cjs",
    // Electron resolves at runtime from node_modules; bundling it breaks it.
    external: mainExternal,
  },
  {
    ...common,
    entryPoints: [
      "src/preload/preload.ts",
      "src/preload/capturePreload.ts",
      "src/preload/browserPreload.ts",
      "src/preload/dropzonePreload.ts",
    ],
    outdir: "dist/preload",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: [
      "src/renderer/overlay.ts",
      "src/renderer/settings.ts",
      "src/renderer/browser.ts",
      "src/renderer/dropzone.ts",
    ],
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
  },
  {
    // Injected into a page as a string, so a sourcemap comment would point at
    // a file that page can never load.
    ...common,
    sourcemap: false,
    entryPoints: ["src/capture/capture.ts", "src/capture/frames.ts"],
    outdir: "dist/capture",
    platform: "browser",
    format: "iife",
  },
  {
    // Also emitted on their own so the capture test and the live-save
    // harness can drive them directly, the same way clipboardWatch is.
    ...common,
    entryPoints: [
      "src/main/archive.ts",
      "src/main/karakeep.ts",
      "src/main/config.ts",
    ],
    outdir: "dist/main",
    outExtension: { ".js": ".cjs" },
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: ["src/main/clipboardWatch.ts"],
    outfile: "dist/main/clipboardWatch.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
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
  for (const f of [
    "overlay.html",
    "settings.html",
    "browser.html",
    "dropzone.html",
    "style.css",
    "icon-dark.png",
    "icon-light.png",
  ]) {
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
