# OpenRator

[![CI](https://github.com/brrrassica/openrator/actions/workflows/ci.yml/badge.svg)](https://github.com/brrrassica/openrator/actions)

Single-pane-of-glass Android app for your **OpenRouter** usage. Credits at a
glance, spend & endpoint analytics, upstream provider policy controls, and API
key oversight — built with Expo / React Native, BYOK on-device (no backend in
v0.1).

*The name: OpenRouter + Operator.* (I know it sucks)

## Status

- **M0 ✅** Foundation & API spikes — verified live 2026-10-05 (`docs/03-spike-notes.md`). Generation-list spike **pivoted the product to Spend & Endpoint analytics** (D7).
- **M1 ✅** Data & client layer — secure-store credentials, typed API client, sync engine, SQLite DAOs, rollups.
- **M2 ✅** Home Pane — themed shell, custom SVG charts, credits card, 14-day spend trend, health strip, pull-to-refresh.
- **M3 ✅** Spend & Endpoint analytics (30-day area chart, endpoint/provider breakdowns, no-mgmt fallback).
- **M4 ✅** Provider Policy & Keys — catalog, preset routing editor with optimistic writes, mgmt-key CRUD + create/reveal flow.
- **M5 ✅** Hardening, QA, release — secrets guard + engine E2E, a11y/theming pass, production APK built via EAS, and **v0.1.0 soak passed** (days of device testing, 2026-10-08).

## Release (v0.1)

Version `0.1.1` is the first **F-Droid-facing** release (Android app id
`tech.alatcerdas.openrator`, MIT licensed). It adds no user-facing features over
tested v0.1.0 — the app-id change is what F-Droid builds from source (tag
`v0.1.1`). Local builds via `eas build -p android --profile production`.

v0.1.0 (2026-10-07, EAS-sideload) passed days of device testing; its artifact:

- APK: https://expo.dev/artifacts/eas/kDDUS4vG-GEgcIWDhhmyoeA0vkc8WAwAbrrrkeHmR3U.apk
- SHA-256: `0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b`

Release runbooks: `docs/04-qa-checklist.md` §4, `docs/05-fdroid-submission.md`.

## Docs

- [`docs/01-specification.md`](docs/01-specification.md) — product spec, verified API surface, architecture, decisions
- [`docs/02-roadmap-v0.1.md`](docs/02-roadmap-v0.1.md) — v0.1 roadmap (M0–M5), effort, exit criteria
- [`docs/03-spike-notes.md`](docs/03-spike-notes.md) — live API spike results (2026-10-05)
- [`docs/04-ci-notes.md`](docs/04-ci-notes.md) — CI setup & ops notes (GitHub Actions + self-hosted Gitea/act_runner)
- [`docs/04-qa-checklist.md`](docs/04-qa-checklist.md) — v0.1 acceptance + device matrix (M5)
- [`docs/05-fdroid-submission.md`](docs/05-fdroid-submission.md) — F-Droid release prep & submission
- [`docs/fdroiddata-tech.alatcerdas.openrator.yml`](docs/fdroiddata-tech.alatcerdas.openrator.yml) — fdroiddata metadata draft
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — changelog
- [`docs/RELEASE-NOTES-v0.1.0.md`](docs/RELEASE-NOTES-v0.1.0.md) — v0.1.0 release notes

## Development

```sh
cd apps/mobile
npm test          # vitest unit suite
npm run typecheck # tsc --noEmit
npm start         # Expo dev server
```

Commits auto-push to the self-hosted mirror via the versioned hook
(`.githooks/`, enabled with `core.hooksPath`; it targets the `gitea` remote only).
GitHub is pushed explicitly with `git push github main`.
