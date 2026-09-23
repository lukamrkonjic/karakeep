---
name: update-karakeep
description: Update the Karakeep that runs on Luka's Synology NAS (DS923+, http://192.168.0.20:3020) to a new build of this fork, roll it back, or stop and start it. Use after pushing to main, or whenever Luka asks how to deploy, update, upgrade, restart or stop Karakeep on the NAS. The NAS follows the :latest image and downloads new builds by itself (a DSM scheduled task), so an update is a restart; has the one-time setup, rollback, and the fixes for the errors seen so far.
---

# Updating Karakeep on the NAS

The NAS runs this fork as a Docker Compose project that follows the image's
`:latest` tag. Pushing to `main` builds a new `:latest`; a scheduled task on
the NAS downloads it within ten minutes of the build finishing; restarting
the project switches to it.

| What | Where |
|---|---|
| NAS | `global@192.168.0.20` (Synology DS923+); Karakeep at http://192.168.0.20:3020 |
| Project folder | `/volume1/docker/karakeep` |
| Compose file | `compose.yaml` — not `docker-compose.yml` |
| Containers | `karakeep-web-1` (Karakeep and its workers), `karakeep-chrome-1`, `karakeep-meilisearch-1` |
| Image | `ghcr.io/lukamrkonjic/karakeep:latest`. Every build is also tagged with the first 7 characters of its commit, for rolling back |
| Download task | DSM Task Scheduler → "Karakeep: download latest build", every 10 minutes |
| Running version | Settings → Admin shows `fork-<commit>` (builds from 2026-09-23 on) |

## Updating

1. Push to `main`. The **Build Fork Image** workflow builds and publishes the
   image in about 15 minutes (https://github.com/lukamrkonjic/karakeep/actions).
2. Within ten minutes of it going green, the NAS has downloaded it.
3. Restart onto it — this stops the old container, creates a new one from
   the downloaded image and starts it, applying any database migrations:

   ```bash
   ssh global@192.168.0.20
   ```

   ```bash
   cd /volume1/docker/karakeep
   ```

   ```bash
   sudo docker compose up -d
   ```

   It prints `Recreated` for `web` when there was something new, and
   `Running` when the NAS hasn't downloaded the build yet (see below).
4. Settings → Admin shows the version, `fork-` plus the commit you pushed.

To stop first and start separately instead, `sudo docker compose down` and
then `sudo docker compose up -d` do the same.

**Not downloaded yet, or can't wait for the task?** Fetch it now:

```bash
sudo docker pull ghcr.io/lukamrkonjic/karakeep:latest
```

## Setup (once)

Point the project at `:latest`:

```bash
cd /volume1/docker/karakeep
```

```bash
sudo sed -i -E 's#(ghcr.io/lukamrkonjic/karakeep):[A-Za-z0-9._-]+#\1:latest#' compose.yaml
```

```bash
grep -n "image:" compose.yaml
```

Then create the download task in DSM: **Control Panel → Task Scheduler →
Create → Scheduled Task → User-defined script**.

- **General:** Task `Karakeep: download latest build`, User `root`.
- **Schedule:** Daily; first run `00:00`, repeat every **10 minutes**
  (DSM 7 calls it Frequency), last run `23:50`.
- **Task Settings → Run command → User-defined script:**

  ```sh
  /usr/local/bin/docker pull ghcr.io/lukamrkonjic/karakeep:latest > /dev/null && /usr/local/bin/docker image prune -f > /dev/null
  ```

  The pull only downloads when there is a new build. The prune removes
  images nothing uses any more, such as the version before the last
  restart; images a container still runs on are never touched.

Select the task and press **Run** once to check it. Afterwards
`sudo docker images ghcr.io/lukamrkonjic/karakeep` lists `latest` with the
time it was built.

## Stop and start

In `/volume1/docker/karakeep`. Stop and remove the containers (the
bookmarks stay; they live in `./data` and `./meilisearch`):

```bash
sudo docker compose down
```

Never add `-v` to that. Start again:

```bash
sudo docker compose up -d
```

## Roll back

Every build keeps its own tag. Pin the one to go back to (from the Actions
page or `git log`; replace `OLDTAG`), fetch it, and restart:

```bash
sudo sed -i -E 's#(ghcr.io/lukamrkonjic/karakeep):[A-Za-z0-9._-]+#\1:OLDTAG#' compose.yaml
```

```bash
sudo docker compose pull web
```

```bash
sudo docker compose up -d
```

While pinned, new builds aren't picked up: point it back at `latest` with
the same `sed` (tag `latest`) and `sudo docker compose up -d`.

Migrations only go forward, so the older version runs on the newer database.
That works as long as the new migrations only added tables or columns, which
is true of every fork migration so far (`FORK_CHANGES.md` lists them).

## When something fails

- **`up -d` says `Running`, not `Recreated`** — the new build isn't on the NAS
  yet: the workflow is still running, or the task hasn't come round. Pull it
  by hand (above) and run `up -d` again.
- **`no configuration file provided: not found`** — you're not in the project
  folder. `cd /volume1/docker/karakeep`; if the folder ever moves, this finds
  it from the running container:

  ```bash
  cd "$(sudo docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' karakeep-web-1)"
  ```

- **`sed: can't read docker-compose.yml`** — the file is `compose.yaml`.
- **`docker compose pull` stops at `gcr.io/zenika-hub/alpine-chrome` with
  "requires billing to be enabled"** — pull `web` only (below). The task pulls
  the Karakeep image by name, so it isn't affected.
- **`manifest unknown` when pulling a version tag** — the build hasn't
  finished or failed (check the Actions page), or the tag is mistyped.
- **`Sorry, try again.`** — the `sudo` password was mistyped.

### The Chrome image

The `chrome` service still uses `gcr.io/zenika-hub/alpine-chrome:124`, which
Google no longer serves, so a plain `docker compose pull` fails. The copy
already on the NAS keeps working, which is why pulling `web` alone is
enough. To fix it for good, replace the `chrome` service in `compose.yaml`
with upstream's current one (from `docker/docker-compose.yml` in this repo);
after that a plain `sudo docker compose pull` works. Not yet tried on the
NAS.

```yaml
  chrome:
    image: ghcr.io/karakeep-app/karakeep-chrome:release
    restart: unless-stopped
    init: true
    command:
      - --disable-gpu
      - --disable-dev-shm-usage
      - --hide-scrollbars
      - --disable-blink-features=AutomationControlled
      - --window-size=1440,900
```

## For Claude

- You can't run the NAS commands: SSH needs Luka's password, and you never
  ask for it or type it. Do everything up to the NAS yourself, then give Luka
  the commands, one command per `bash` code block (the app puts a Run button
  on each).
- After a push, find the build and wait for it. `gh` isn't installed on this
  PC; the public API works:

  ```bash
  curl -s "https://api.github.com/repos/lukamrkonjic/karakeep/actions/runs?head_sha=$(git rev-parse HEAD)" | python -c "import sys,json; print([(r['id'], r['status'], r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']])"
  ```

- When it's green, tell Luka: the NAS has it within ten minutes (or he pulls
  it by hand), then `sudo docker compose up -d`, and Settings → Admin should
  read `fork-<the short commit>`. To confirm a tag exists (prints 200):

  ```bash
  T=$(curl -s "https://ghcr.io/token?scope=repository:lukamrkonjic/karakeep:pull" | python -c "import sys,json; print(json.load(sys.stdin)['token'])")
  curl -s -o /dev/null -w "%{http_code}\n" -I -H "Authorization: Bearer $T" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" https://ghcr.io/v2/lukamrkonjic/karakeep/manifests/NEWTAG
  ```

- Every push to `main` builds an image, including a docs-only one; there's
  nothing to deploy for those.
