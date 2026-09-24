---
name: push-karakeep
description: Commit and push work on this Karakeep fork (C:\Dev\karakeep) to main. Runs the checks the pre-commit hook would, then commits with `git commit --no-verify` WITHOUT asking (Luka has approved skipping the hook for good; it always fails on this Windows checkout), pushes, and waits for the NAS image to build. Use whenever Luka asks to commit, push, ship or "push everything to main" in this repo.
---

# Committing and pushing the fork

Every push to `main` builds a new image for the NAS (see `update-karakeep`).
Commit and push only when Luka asks. When he says "don't push", stop after
the checks, or after a local commit if he asked for one.

## The hook: always `--no-verify`, never ask

The husky pre-commit hook always fails on this checkout. Git's global
`core.autocrlf=true` gives the working files CRLF endings, so the hook's
repo-wide `oxfmt --check` and open-api check fail whatever you changed.
**Luka said (2026-09-24) to always commit with `--no-verify` and to stop
asking him about it.** You run what the hook would have caught yourself:

## Before committing

On what you changed, package by package (`apps/web`, `apps/workers`,
`packages/*`):

1. `npx oxfmt <files>` (write mode, not `--check`), then
   `npx oxlint <files>`: 0 warnings, 0 errors.
2. `npx tsc --noEmit -p .` in each package you touched.
3. `npx vitest run` in each package you touched. Three tests in
   `apps/web/lib/date-format.test.ts` fail on this PC whatever you do: they
   expect a UTC, en-US machine and this one is Swedish. Ignore those,
   nothing else.
4. OpenAPI: `pnpm --filter @karakeep/open-api run generate`, then
   `git status packages/open-api`. It only changes when a REST schema did;
   commit what it wrote.
5. Database: in `packages/db`, `npx drizzle-kit generate` must print "No
   schema changes" (give it a scratch `DATA_DIR`), unless the change adds a
   migration on purpose. Then commit the new `drizzle/NNNN_*.sql` with its
   snapshot and journal entry.
6. `FORK_CHANGES.md` (the merge guide): every fork change has its row
   (🟢 new file, 🟡 small edit to an upstream file, 🔴 reworked upstream
   file). Anything that can break after an upstream merge also gets a
   "What to test" line.

## Commit and push

- Stage files by name. Never `git add -A` or `git add .`: `next dev`
  writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`, which are never
  committed (delete them).
- Write the message with the Write tool into your scratchpad (a heredoc
  mangles backticks and line endings). Subject under 72 characters, a body
  saying what changed and why, and the attribution lines the session asks
  for at the end.
- Then:

  ```bash
  git commit --no-verify -F <message file>
  ```

  ```bash
  git push origin main
  ```

- If the push is rejected because `main` moved, `git pull --rebase origin
  main` and push again. Never force-push `main`.

## After the push

Wait for the **Build Fork Image** workflow in the background (about 15
minutes). This prints `completed success` when it's done:

```bash
sha=$(git rev-parse HEAD); for i in $(seq 1 60); do out=$(curl -s "https://api.github.com/repos/lukamrkonjic/karakeep/actions/runs?head_sha=$sha" | python -c "import json,sys; r=[x for x in json.load(sys.stdin).get('workflow_runs',[]) if x['name']=='Build Fork Image']; print((r[0]['status']+' '+str(r[0]['conclusion'])) if r else 'none')"); case "$out" in completed*) echo "$out"; exit 0;; esac; sleep 60; done; echo "still running: $out"
```

Then confirm `:latest` is the new build and give Luka the NAS steps. Both
are in `update-karakeep` (its "For Claude" section).
