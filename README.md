# OpenRator

[![CI](http://192.168.100.130:3000/sam/openrator/actions/workflows/ci.yml/badge.svg)](http://192.168.100.130:3000/sam/openrator/actions)

Single-pane-of-glass Android app for your **OpenRouter** usage. Credits at a
glance, spend & endpoint analytics, upstream provider policy controls, and API
key oversight — built with Expo / React Native, BYOK on-device (no backend in
v0.1).

*The name: OpenRouter + curator.*

## Status

- **M0 ✅** Foundation & API spikes — verified live 2026-10-05 (`docs/03-spike-notes.md`). Generation-list spike **pivoted the product to Spend & Endpoint analytics** (D7).
- **M1 ✅** Data & client layer — secure-store credentials, typed API client, sync engine, SQLite DAOs, rollups.
- **M2 ✅** Home Pane — themed shell, custom SVG charts, credits card, 14-day spend trend, health strip, pull-to-refresh.
- **M3 ✅** Spend & Endpoint analytics (30-day area chart, endpoint/provider breakdowns, no-mgmt fallback).
- **M4 ✅** Provider Policy & Keys — catalog, preset routing editor with optimistic writes, mgmt-key CRUD + create/reveal flow.
- **M5 🔜** Hardening, QA, release — secrets guard + engine E2E shipped; device matrix + EAS build are the last stretch (`docs/04-qa-checklist.md`).

## Release (v0.1)

Version `0.1.0` builds via `eas build -p production` (production channel, Android
APK for sideload — no store listing in v0.1). Release runbook: `docs/04-qa-checklist.md` §4.
Physical-device-only items (mgmt-key acceptance, soak) are tracked there.

## Repos & CI

- Primary mirror (auto-synced on every commit): Gitea — http://192.168.100.130:3000/sam/openrator (`ssh://git@192.168.100.130:2222/sam/openrator.git`)
- CI: Gitea Actions via the homelab `act_runner` — tests, typecheck, Android export on every push (`.gitea/workflows/ci.yml`, notes in `docs/04-ci-notes.md`)
- Level of effort: ~21–27 dev-days for v0.1 (M0–M5).

## Docs

- [`docs/01-specification.md`](docs/01-specification.md) — product spec, verified API surface, architecture, decisions
- [`docs/02-roadmap-v0.1.md`](docs/02-roadmap-v0.1.md) — v0.1 roadmap (M0–M5), effort, exit criteria
- [`docs/03-spike-notes.md`](docs/03-spike-notes.md) — live API spike results (2026-10-05)
- [`docs/04-ci-notes.md`](docs/04-ci-notes.md) — Gitea + Actions setup & ops notes
- [`docs/04-qa-checklist.md`](docs/04-qa-checklist.md) — v0.1 acceptance + device matrix (M5)
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — release notes

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