# OpenRator

[![CI](https://github.com/brrrassica/openrator/actions/workflows/ci.yml/badge.svg)](https://github.com/brrrassica/openrator/actions)

![OpenRator — one pane for every AI bill](docs/assets/social-preview.png)

Single-pane-of-glass Android app for your **AI spend** — starting with
**OpenRouter**, expanding to **OpenCode Go** (subscription % windows) and
**OpenCode Zen** (pay-as-you-go, microcents) in v0.2. Credits at a glance, spend
& endpoint analytics, upstream provider policy controls, and API key oversight —
built with Expo / React Native, BYOK on-device (no backend).

*The name: OpenRouter + Operator.* (I know it sucks)

## Status

- **v0.2.0 🚧** Multi-provider core, brand refresh, and local alerts — plan in [`plans/v0.2.0-plan.md`](plans/v0.2.0-plan.md). Brand workstream (M6) is in progress.
- **M0 ✅** Foundation & API spikes — verified live 2026-10-05 (`docs/03-spike-notes.md`). Generation-list spike **pivoted the product to Spend & Endpoint analytics** (D7).
- **M1 ✅** Data & client layer — secure-store credentials, typed API client, sync engine, SQLite DAOs, rollups.
- **M2 ✅** Home Pane — themed shell, custom SVG charts, credits card, 14-day spend trend, health strip, pull-to-refresh.
- **M3 ✅** Spend & Endpoint analytics (30-day area chart, endpoint/provider breakdowns, no-mgmt fallback).
- **M4 ✅** Provider Policy & Keys — catalog, preset routing editor with optimistic writes, mgmt-key CRUD + create/reveal flow.
- **M5 ✅** Hardening, QA, release — secrets guard + engine E2E, a11y/theming pass, and a **production APK built via EAS** (build `e6e1199a…`, commit `805ac83`). Device sideload + 72 h soak remain (physical-device-only; `docs/04-qa-checklist.md`).

## Release (v0.1)

Version `0.1.0` builds via `eas build -p android --profile production` (production
channel, Android APK for sideload — no store listing in v0.1). The current artifact
was built 2026-10-07:

- APK: https://expo.dev/artifacts/eas/kDDUS4vG-GEgcIWDhhmyoeA0vkc8WAwAbrrrkeHmR3U.apk
- SHA-256: `0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b`

Release runbook: `docs/04-qa-checklist.md` §4. Physical-device-only items
(mgmt-key acceptance, sideload, soak) are tracked there.

## Docs

- [`plans/v0.2.0-plan.md`](plans/v0.2.0-plan.md) — v0.2.0 multi-provider + brand + alerts plan
- [`docs/01-specification.md`](docs/01-specification.md) — product spec, verified API surface, architecture, decisions
- [`docs/02-roadmap-v0.1.md`](docs/02-roadmap-v0.1.md) — v0.1 roadmap (M0–M5), effort, exit criteria
- [`docs/03-spike-notes.md`](docs/03-spike-notes.md) — live API spike results (2026-10-05)
- [`docs/05-provider-integrations.md`](docs/05-provider-integrations.md) — OpenCode Go/Zen units, capability matrix, manual fallback
- [`docs/04-ci-notes.md`](docs/04-ci-notes.md) — CI setup & ops notes (GitHub Actions + self-hosted Gitea/act_runner)
- [`docs/04-qa-checklist.md`](docs/04-qa-checklist.md) — v0.1 acceptance + device matrix (M5)
- [`docs/06-brand-guide.md`](docs/06-brand-guide.md) — mark, palette, typography, icon grid, asset pipeline
- [`docs/assets/README.md`](docs/assets/README.md) — index and previews of every generated brand asset
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — changelog
- [`docs/RELEASE-NOTES-v0.1.0.md`](docs/RELEASE-NOTES-v0.1.0.md) — v0.1.0 release notes

## Development

```sh
cd apps/mobile
npm test            # vitest unit suite
npm run typecheck   # tsc --noEmit
npm start           # Expo dev server
npm run assets:build # regenerate brand PNGs from SVG masters
npm run assets:check # fail on asset drift (CI)
```

Commits auto-push to the self-hosted mirror via the versioned hook
(`.githooks/`, enabled with `core.hooksPath`; it targets the `gitea` remote only).
GitHub is pushed explicitly with `git push github main`.
