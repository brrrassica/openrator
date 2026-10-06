# OpenRator

[![CI](http://192.168.100.130:3000/sam/openrator/actions/workflows/ci.yml/badge.svg)](http://192.168.100.130:3000/sam/openrator/actions)

Single-pane-of-glass Android app for your **OpenRouter** usage. Credits at a
glance, spend & endpoint analytics, upstream provider policy controls, and API
key oversight — built with Expo / React Native, BYOK on-device (no backend in
v0.1).

*The name: OpenRouter + curator.*

## Status

- **M0 ✅** Foundation & API spikes — verified live 2026-10-05 (`docs/03-spike-notes.md`). Generation-list spike **pivoted the product to Spend & Endpoint analytics** (D7).
- **M1 ✅** Data & client layer — secure-store credentials, typed API client, sync engine, SQLite DAOs, rollups (50 unit tests).
- **M2 ✅** Home Pane — themed shell, custom SVG charts, credits card, 14-day spend trend, top endpoints, health strip, pull-to-refresh.
- **M3 →** Spend & Endpoint analytics (30-day activity, mgmt key).

## Repos & CI

- Primary mirror (auto-synced on every commit): Gitea — http://192.168.100.130:3000/sam/openrator (`ssh://git@192.168.100.130:2222/sam/openrator.git`)
- CI: Gitea Actions via the homelab `act_runner` — tests, typecheck, Android export on every push (`.gitea/workflows/ci.yml`, notes in `docs/04-ci-notes.md`)
- Level of effort: ~21–27 dev-days for v0.1 (M0–M5).

## Docs

- [`docs/01-specification.md`](docs/01-specification.md) — product spec, verified API surface, architecture, decisions
- [`docs/02-roadmap-v0.1.md`](docs/02-roadmap-v0.1.md) — v0.1 roadmap (M0–M5), effort, exit criteria
- [`docs/03-spike-notes.md`](docs/03-spike-notes.md) — live API spike results (2026-10-05)
- [`docs/04-ci-notes.md`](docs/04-ci-notes.md) — Gitea + Actions setup & ops notes

## Development

```sh
cd apps/mobile
npm test          # vitest unit suite
npm run typecheck # tsc --noEmit
npm start         # Expo dev server
```

Commits auto-push to the Gitea mirror via the versioned hook (`.githooks/`,
enabled with `core.hooksPath`).

## Confirmed decisions (2026-10-05)

| D | Decision |
|---|---|
| D1 | Expo / React Native (true Android app from React/TS) |
| D2 | BYOK on-device, no backend in v0.1 |
| D3 | Provider controls = Presets-based policy editor + read-only reflection + deep-link to dashboard privacy settings |
| D4 | Personal tool first; productize after v0.2 validation |
| D5 | Branding: **OpenRator** |
| D7 | Usage feature = Spend & Endpoint analytics via `/activity` (mgmt key) — public API exposes no per-request generation list |