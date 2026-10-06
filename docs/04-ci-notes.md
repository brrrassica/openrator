# OpenRator — Gitea & CI operations notes

**Status 2026-10-05:** wired. CI is green (run validation: vitest + tsc +
Android export). These notes capture the exact plumbing so it survives
restarts, rebuilds, and future contributors.

## Topology

- **Gitea** — VM `more-services` (192.168.100.130), container
  `big-bear-gitea` (`gitea/gitea:1.27.0`), HTTP `:3000`, Git SSH `:2222`.
  Data under `/DATA/AppData/big-bear-gitea`. Gitea store is reachable via
  `ssh sam@192.168.100.130` (key `~/.ssh/context-132`).
- **Runner** — VM `opencode-sam` (this box), container `gitea-act-runner`
  (`gitea/act_runner:latest`), Docker executor, mounted config at
  `/opt/act-runner/config.yaml`, registered to `http://192.168.100.130:3000`.
- **Repo** — `sam/openrator` (public), default branch `main`.

## Repo wiring (this checkout)

```sh
git remote -v            # gitea → ssh://git@192.168.100.130:2222/sam/openrator.git
git config core.hooksPath   # .githooks → versioned post-commit hook
```

- **Auto-sync:** `.githooks/post-commit` runs `scripts/sync-gitea.sh` after
  every local commit → pushes the current branch to `gitea` (silent no-op if
  the remote is absent, so CI checkouts don't re-push).
- **SSH key:** `~/.ssh/context-132` is registered to the `sam` Gitea account
  ("openrator-sync", key id 1, full `write:repository` + `write:user` via the
  `openrator-ci` token — see below for token lifecycle).

## CI pipeline (`.gitea/workflows/ci.yml`)

`push` to `main` (and `m*`/`dev*`) + `pull_request` → single job on
`ubuntu-latest` (docker://catthehacker/ubuntu:act-latest):

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (node 22, npm cache declared)
3. `npm ci` — wrapped in a 3× retry loop with `--fetch-retries=5` (homelab
   egress from job containers is flaky; observed `ECONNRESET`)
4. `npx vitest run`
5. `npx tsc --noEmit`
6. `npx expo export --platform android --output-dir dist-ci`

## Runner quirks (learned the hard way)

1. **act_runner cache disabled** — `cache.enabled: false` in
   `/opt/act-runner/config.yaml`. The built-in cache server listens on the
   host bridge (`172.17.0.2:33867`) but job containers run on the custom
   `ci-net` network → cache restore/save timed out and **hung jobs for 10+
   minutes**. Cheap `npm ci` (30 s) makes caching unnecessary here.
2. Jobs run with `--cpus 3 --memory 3g --sysctl net.ipv6…=1`; `force_pull: true`
   re-pulls the ~1.6 GB act image per run (fast on LAN cache).
3. **`.gitignore` hazard:** the old `core*` pattern (meant for node crash
   dumps) also excluded `src/core/` from commits — the fresh CI checkout
   caught it instantly where local runs could not. Pattern is now `core.[0-9]*`.

## Token lifecycle (admin ops)

- Create: `ssh .130` then
  `docker exec -u git big-bear-gitea gitea admin user generate-access-token -u sam -t <name> --scopes <scopes> --raw`
  — note **`-u git`** (CLI refuses root) and **`-t`** flag.
- The `openrator-ci` token (`write:repository,write:user`) is used operationally
  for API calls; rotate/delete it after provisioning when desired.
- Watch runs: `GET /api/v1/repos/sam/openrator/actions/runs` with a
  `read:repository` token; badge: `/sam/openrator/actions/workflows/ci.yml/badge.svg`.

## Restart checklist

- Gitea: `docker restart big-bear-gitea` (on `.130`).
- Runner: `docker restart gitea-act-runner` (this box) — re-declares with
  labels `ubuntu-latest, ubuntu-24.04, ubuntu-22.04, ubuntu-20.04`.
- If a job container orphans: `docker rm -f GITEA-ACTIONS-TASK-*`.