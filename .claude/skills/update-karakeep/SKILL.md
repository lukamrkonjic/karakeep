---
name: update-karakeep
description: Update the Karakeep that runs on Luka's Synology NAS (DS923+, http://192.168.0.20:3020) to a new build of this fork, roll it back, or stop and start it. Use after pushing to main, or whenever Luka asks how to deploy, update, upgrade, restart or stop Karakeep on the NAS. Has the exact SSH commands (bump the image tag in compose.yaml, pull web, up -d) and the fixes for the errors seen so far.
---

# Updating Karakeep on the NAS

The NAS runs this fork as a Docker Compose project. A new version is a new
image tag: pushing to `main` builds one, and updating the NAS means pointing
`compose.yaml` at it.

| What | Where |
|---|---|
| NAS | `global@192.168.0.20` (Synology DS923+); Karakeep at http://192.168.0.20:3020 |
| Project folder | `/volume1/docker/karakeep` |
| Compose file | `compose.yaml` — not `docker-compose.yml` |
| Containers | `karakeep-web-1` (Karakeep and its workers), `karakeep-chrome-1`, `karakeep-meilisearch-1` |
| Image | `ghcr.io/lukamrkonjic/karakeep:<tag>`; the tag is the first 7 characters of the commit (`:latest` is the newest build too) |

## 1. Build the image

Push to `main`. The **Build Fork Image** workflow builds and publishes the
image in about 15 minutes. Wait until it's green at
https://github.com/lukamrkonjic/karakeep/actions.

The tag is the pushed commit's short hash:

```bash
git rev-parse --short=7 HEAD
```

## 2. Update the NAS

Log in. It asks for the NAS password, and each `sudo` may ask again:

```bash
ssh global@192.168.0.20
```

Go to the project folder:

```bash
cd /volume1/docker/karakeep
```

See what runs now, and note the current tag in case you want to go back:

```bash
sudo docker ps --format '{{.Names}}  {{.Image}}' | grep -i karakeep
```

Point Karakeep at the new tag (replace `NEWTAG`, for example `4bd3343`):

```bash
sudo sed -i -E 's#(ghcr.io/lukamrkonjic/karakeep):[A-Za-z0-9._-]+#\1:NEWTAG#' compose.yaml
```

Check that it changed:

```bash
grep -n "image:" compose.yaml
```

Download the new image. Pull `web` only (see [the Chrome image](#the-chrome-image)
for why):

```bash
sudo docker compose pull web
```

Start it. Compose replaces only the container whose image changed, and
Karakeep applies any new database migrations as it starts:

```bash
sudo docker compose up -d
```

Confirm the new tag is running, then open http://192.168.0.20:3020:

```bash
sudo docker ps --format '{{.Names}}  {{.Image}}' | grep -i karakeep
```

If something looks wrong, read the log:

```bash
sudo docker compose logs --tail 100 web
```

There's no need to stop anything first: `up -d` swaps the container itself.

**In Container Manager instead:** Project → karakeep → YAML → change the tag on
the `ghcr.io/lukamrkonjic/karakeep` line → Build.

## Stop and start

All of these run in `/volume1/docker/karakeep`. Stop and remove the
containers (the bookmarks stay; they live in the volumes):

```bash
sudo docker compose down
```

Never add `-v` to that: it deletes the volumes, which is all of Karakeep's
data.

Start again:

```bash
sudo docker compose up -d
```

## Roll back

Put the old tag back (the one `docker ps` showed before the update), then
pull and start as in step 2:

```bash
sudo sed -i -E 's#(ghcr.io/lukamrkonjic/karakeep):[A-Za-z0-9._-]+#\1:OLDTAG#' compose.yaml
```

Migrations only go forward, so the older version runs on the newer database.
That works as long as the new migrations only added tables or columns, which
is true of every fork migration so far (`FORK_CHANGES.md` lists them).

## When something fails

- **`no configuration file provided: not found`** — you're not in the project
  folder. `cd /volume1/docker/karakeep`; if the folder ever moves, this finds
  it from the running container:

  ```bash
  cd "$(sudo docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' karakeep-web-1)"
  ```

- **`sed: can't read docker-compose.yml`** — the file is `compose.yaml`.
- **`docker compose pull` stops at `gcr.io/zenika-hub/alpine-chrome` with
  "requires billing to be enabled"** — pull `web` only (below).
- **`manifest unknown` when pulling** — the build hasn't finished or failed
  (check the Actions page), or the tag is mistyped.
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
  the commands with the real tag filled in, one command per `bash` code
  block (the app puts a Run button on each).
- After a push, find the build and wait for it. `gh` isn't installed on this
  PC; the public API works:

  ```bash
  curl -s "https://api.github.com/repos/lukamrkonjic/karakeep/actions/runs?head_sha=$(git rev-parse HEAD)" | python -c "import sys,json; print([(r['id'], r['status'], r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']])"
  ```

- Before sending Luka to the NAS, confirm the tag exists (prints 200):

  ```bash
  T=$(curl -s "https://ghcr.io/token?scope=repository:lukamrkonjic/karakeep:pull" | python -c "import sys,json; print(json.load(sys.stdin)['token'])")
  curl -s -o /dev/null -w "%{http_code}\n" -I -H "Authorization: Bearer $T" -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" https://ghcr.io/v2/lukamrkonjic/karakeep/manifests/NEWTAG
  ```

- Every push to `main` builds an image, including a docs-only one; there's
  nothing to deploy for those.
