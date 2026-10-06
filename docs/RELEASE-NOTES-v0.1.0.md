# OpenRator v0.1.0 — release notes (draft)

**Status:** code-complete + CI-verified; device pass pending (see `docs/04-qa-checklist.md`).
**Scope:** Android only (D6: iOS out of v0.1). Personal use (D4); distributed as a
private APK — no store listing.

## What it is

A single-pane-of-glass dashboard for your OpenRouter account — replacement for
jumping between the live dashboard, activity pages, and per-key settings.
Bring-your-own-key, fully on-device: no backend, no accounts, no analytics SDK.

## Features

**Home pane**
- Credits/balance card (limit, remaining, reset window)
- Current key card (label, management badge, usage today / week / month, expiry)
- 14-day spend trend, top endpoints, provider health strip
- Pull-to-refresh, stale-data badges, offline rendering

**Spend & Endpoint analytics** (management key)
- 30-day spend area chart (7/14/30-day windows), totals, day drill-down
- Endpoint breakdown ranked by spend/requests, with provider status-page links
- Provider-share view
- No-management-key fallback (key spend windows) + explainer card

**Provider policy**
- Provider catalog: search, sort by name/region, region chips, status pages
- Preset routing editor: tap a provider to cycle `provider.only/order/ignore`,
  writing a new preset version via the cost-free config endpoint
- Optimistic UI with rollback + version-conflict guard; account-wide prefs
  reflection + deep-links to the dashboard privacy settings

**Keys**
- Current-key card, management-gated list (rename, limit/reset, expiry)
- Create-key flow: show-once reveal + copy + live `/key` test; secret never persisted
- Revoke (double-confirmed) · Clear stored key (sign-out, double-confirmed)

## Security & privacy

- API key only in Android keystore (expo-secure-store); never logged, never in SQLite
- Static secrets guard runs in CI (no secret-logging patterns, network whitelist to
  openrouter.ai only)
- No analytics SDK, no crash reporters, no third-party network calls beyond OpenRouter
- Paste-warning on key entry; key wipe clears associated cached metadata

## Known limitations (v0.1)

- `/activity` is management-key-only; its exact wire shape is still provisional
  until a management-key device pass pins it (tracked as M0.5A)
- Preset/key **delete** is not offered — the public API has no preset-delete surface
  (dashboard-only); keys revoke is supported
- iOS is out of scope; no Play Store listing; personal tool
- Dev-mode dependency: `expo-sqlite` in Expo Go is fine, but premium builds
  (EAS) are required for a standalone APK with all native modules

## Downloads

- APK: produced via `eas build -p android --profile production` (see
  `docs/04-qa-checklist.md` §4) — **attach the artifact to this release** after
  the device pass; until then this release stays in draft.

## Checksum / verification

(Add SHA-256 of the APK here after the build.)

## Also in this release

- 89 unit/integration tests (vitest), including a fixture-driven engine E2E over
  real SQLite that caught and fixed two first-launch blockers (`limit` reserved
  word, `undefined` bind on optional `/key` fields)
- CI on every push: tests → typecheck → Android export (Gitea Actions)