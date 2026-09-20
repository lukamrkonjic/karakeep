/**
 * Connection details compiled into the build.
 *
 * They are what a fresh install starts with, so the packaged app works the
 * moment it opens instead of asking to be set up. Anything saved in Settings
 * wins over them; clearing a field falls back to the value here.
 *
 * This file is NOT in git — the key would otherwise live in the history of a
 * fork of a public repository forever. `defaults.example.ts` is the copy that
 * is tracked, and the build writes this one from it when it is missing.
 */
export const BAKED_SERVER_URL = "";
export const BAKED_API_KEY = "";
