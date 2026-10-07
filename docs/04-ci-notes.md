# OpenRator — CI operations notes

**Status 2026-10-05:** wired. CI is green (run validation: vitest + tsc +
Android export). These notes capture the exact plumbing so it survives
restarts, rebuilds, and future contributors.

## Topology

Two independent backends run the same checks: **GitHub Actions** (cloud,
canonical repo) and **Gitea Actions** (self-hosted mirror).

- **GitHub** — `brrrassica/openrator` (private), workflow
  `.github/workflows/ci.yml` on standard `ubuntu-latest` runners. No homelab
  dependency; this is the CI that runs when you're away from the LAN.
- **Gitea** — self-hosted on a private VM (`<gitea-host>`), container
  `<gitea-container>` (`gitea/gitea:1.27.0`), HTTP `:3000`, Git SSH `:2222`.
  Reachable via `ssh <user>@<gitea-host>` (key `~/.ssh/<gitea-sync-key>`).
- **Runner** — dev workstation, container `<runner-container>`
  (`gitea/act_runner:latest`), Docker executor, mounted config at
  `/opt/<runner>/config.yaml`, registered to `http://<gitea-host>:3000`.
- **Repo** — `sam/openrator` on Gitea, default branch `main`.

## Repo wiring (this checkout)

```sh
git remote -v               # gitea  → ssh://git@<gitea-host>:2222/sam/openrator.git
                            # github → https://github.com/brrrassica/openrator.git
git config core.hooksPath   # .githooks → versioned post-commit hook
```

- **Auto-sync:** `.githooks/post-commit` runs `scripts/sync-gitea.sh` after
  every local commit → pushes the current branch to `gitea` (silent no-op if
  the remote is absent, so CI checkouts don't re-push).
- **Sync scope:** the hook pushes the `gitea` remote **only** — GitHub is
  pushed explicitly (`git push github main`), so commits never leave the box
  unattended.
- **SSH key:** a dedicated key (`~/.ssh/<gitea-sync-key>`) is registered to the
  Gitea account with full `write:repository` + `write:user` (provisioned with
  the `openrator-ci` token — see token lifecycle below).

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
   host bridge (`<docker-bridge>:33867`) but job containers run on the custom
   `ci-net` network → cache restore/save timed out and **hung jobs for 10+
   minutes**. Cheap `npm ci` (30 s) makes caching unnecessary here.
2. Jobs run with `--cpus 3 --memory 3g --sysctl net.ipv6…=1`; `force_pull: true`
   re-pulls the ~1.6 GB act image per run (fast on LAN cache).
3. **`.gitignore` hazard:** the old `core*` pattern (meant for node crash
   dumps) also excluded `src/core/` from commits — the fresh CI checkout
   caught it instantly where local runs could not. Pattern is now `core.[0-9]*`.

## Token lifecycle (admin ops)

- Create: SSH to the Gitea host, then run the Gitea CLI inside the container:
  `docker exec -u git <gitea-container> gitea admin user generate-access-token -u <user> -t <name> --scopes <scopes> --raw`
  — note **`-u git`** (the CLI refuses root) and the **`-t`** flag.
- The `openrator-ci` token (`write:repository,write:user`) is used operationally
  for API calls; rotate/delete it after provisioning when desired.
- Watch runs: `GET /api/v1/repos/sam/openrator/actions/runs` with a
  `read:repository` token; badge: `/sam/openrator/actions/workflows/ci.yml/badge.svg`.

## GitHub Actions (cloud CI)

- Workflow: `.github/workflows/ci.yml` — same three checks as Gitea
  (vitest → `tsc --noEmit` → `expo export --platform android`), plus the
  Android bundle uploaded as a `android-bundle` artifact (7-day retention).
- Triggers: `push` to `main`/`m*`/`dev*` and every `pull_request`.
- Dependency caching is left to `actions/setup-node` here — the 3× retry loop
  in the Gitea workflow exists only for the flaky LAN egress (see quirks).
- **No secrets are required in-repo:** the app is BYOK on-device, so CI needs no
  OpenRouter key. Never add one as a repo secret for tests — the suite uses
  `sk-or-v1-…` fixtures only.

## Restart checklist

- Gitea: `docker restart <gitea-container>` (on the Gitea host).
- Runner: `docker restart <runner-container>` (dev workstation) — re-declares with
  labels `ubuntu-latest, ubuntu-24.04, ubuntu-22.04, ubuntu-20.04`.
- If a job container orphans: `docker rm -f GITEA-ACTIONS-TASK-*`.