# OpenRator v0.1.1 — release notes

**Status:** released 2026-10-08 — first **F-Droid-facing** release.
**Scope:** Android only. No user-facing feature changes over v0.1.0, which
passed days of device testing (2026-10-08).

## Why 0.1.1

The v0.1.0 APK (built via EAS) used the old Android app id `ai.openrator.app`.
F-Droid builds everything from source, so the first buildable release must
carry the new id:

- Android app id `ai.openrator.app` → **`tech.alatcerdas.openrator`**
  (`apps/mobile/app.json`); `versionCode` 1 → 2
- License is now **MIT** (`LICENSE` root + `apps/mobile/LICENSE`; the Expo
  template license is preserved as `apps/mobile/LICENSE.expo-template`)
- `package.json`/lockfile license field `0BSD` → `MIT`

## Store metadata (this release adds it)

- Fastlane/Triple-T upstream metadata at the repo root: short + full
  description, 512 px icon, changelogs for version codes 1 & 2,
  `phoneScreenshots/` placeholder (screens to be captured from device)
- fdroiddata draft + submission runbook: `docs/fdroiddata-tech.alatcerdas.openrator.yml`,
  `docs/05-fdroid-submission.md`

## Build & downloads

- F-Droid builds from **tag `v0.1.1`** (commit `da462ed`, expected
  output: `android/app/build/outputs/apk/release/app-release.apk`)
- Local sideload artifact (as before): `eas build -p android --profile production`
- v0.1.0 EAS artifact (superseded):
  https://expo.dev/artifacts/eas/kDDUS4vG-GEgcIWDhhmyoeA0vkc8WAwAbrrrkeHmR3U.apk
  SHA-256 `0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b`

## Features (unchanged from v0.1.0)

Home pane (credits, key usage, 14-day trend, health strip) · Spend & Endpoint
analytics (30-day chart, endpoint/provider breakdowns, no-mgmt fallback) ·
Provider policy editor (preset routing, optimistic writes) · Keys
(management CRUD, create/reveal, revoke) — all on-device, BYOK, no accounts,
no analytics SDK.

## Verification

- 108 unit/integration tests (vitest), Gitea + GitHub Actions CI
  (tests → typecheck → Android export) on every push
- v0.1.0 user-tested for days on-device (2026-10-08); v0.1.1 changes only
  app id / licensing / store metadata