# OpenRator v0.1.1 — release notes

![OpenRator horizontal lockup](assets/lockup-horizontal.png)

**Status:** re-released 2026-11-01 with a signed APK attached
(`app-release.apk`). The original tag was created 2026-10-08 as the first
F-Droid-facing release, but carried no binary.
**Version:** `0.1.1` · **versionCode:** `2` · **package:** `tech.alatcerdas.openrator`.
**Scope:** Android only. No user-facing feature changes over v0.1.0, which
passed days of device testing.

## Release artifact

- `app-release.apk` — EAS build `c45b0765-e3d2-461a-85ab-377acdcc7998`,
  commit `46beea9`, built from tag `v0.1.1` on the `production` profile.
- Size: 86,462,150 bytes · SHA-256:
  `c24e424309e7826dfcdcfb11673ada77337e7d5a9ac9f50a0250aa03a74428ef`.
- Signing certificate SHA-256:
  `389f40887d99b5947ae467e6120554d2c54afc12103123559bbb26f8c30ae79f`
  (shared with the v0.2.0 APK).

## Why 0.1.1

The v0.1.0 APK (built via EAS) used the old Android app id `ai.openrator.app`.
F-Droid builds everything from source, so the first buildable release must
carry the new id:

- Android app id `ai.openrator.app` → **`tech.alatcerdas.openrator`**
  (`apps/mobile/app.json`); `versionCode` 1 → 2
- License is now **MIT** (`LICENSE` root + `apps/mobile/LICENSE`; the Expo
  template license is preserved as `apps/mobile/LICENSE.expo-template`)
- `package.json`/lockfile license field `0BSD` → `MIT`

## Store metadata

- Fastlane/Triple-T upstream metadata at the repo root: short + full
  description, 512 px icon, changelogs for version codes 1 & 2,
  `phoneScreenshots/` placeholder (screens to be captured from device)
- fdroiddata draft + submission runbook:
  `docs/fdroiddata-tech.alatcerdas.openrator.yml`,
  `docs/05-fdroid-submission.md`

## Build & downloads

- F-Droid builds from **tag `v0.1.1`** (commit `46beea9`).
- Attached APK: `app-release.apk` (EAS `production` profile, internal
  distribution). The build used Node `22.14.0` and the
  `ubuntu-24.04-jdk-17-ndk-r27b` image.
- v0.1.0 EAS artifact (superseded, expired).

## Features (unchanged from v0.1.0)

Home pane (credits, key usage, 14-day trend, health strip) · Spend & Endpoint
analytics (30-day chart, endpoint/provider breakdowns, no-mgmt fallback) ·
Provider policy editor (preset routing, optimistic writes) · Keys
(management CRUD, create/reveal, revoke) — all on-device, BYOK, no accounts,
no analytics SDK.

## Verification

- 108 unit/integration tests (vitest), Gitea + GitHub Actions CI
  (tests → typecheck → Android export) on every push.
- v0.1.0 user-tested for days on-device; v0.1.1 changes only
  app id / licensing / store metadata.
