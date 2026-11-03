# Changelog

![OpenRator v0.2 release banner](assets/release-banner.png)

## [0.2.2] — 2026-11-03 — Report accuracy fixes (source-only)

### Fixed
- Home "spend today" only counted the first provider on the All-providers
  scope. `DailyRollup` is keyed by `(provider, day)`, so the day can span
  several rows; `computeHomeSummary` used `find` and dropped the rest, while
  the 14-day trend summed them. Now sums every row for the day, so the today
  figure and the last trend point agree.
- Device-evidence rendering marked **failed** sign-offs as checked. The
  checkbox was embedded in the `pass` label, so a `false` sign-off rendered as
  `[ ] [x] pass / fail`, and `validateDeviceEvidence` gated on "contains a
  checked box" rather than on which branch was checked — a failed row passed
  strict validation. The renderer now checks whichever branch is true, and the
  gate requires `pass` (or `yes`) checked with `fail` unchecked, so a
  hand-edited `[ ] pass / [x] fail` fails too.
- 6 regression tests for both fixes; suite at 231 tests.

### Changed
- Version bump to `0.2.2` (versionCode 5) across `package.json`, `app.json`,
  `docs/release.json`, and the OpenCode client `User-Agent`.

## [0.2.0] — 2026-10-31 — QA & release gates (source-only)

### Added
- **M5.5** Acceptance criterion 7 is now a real gate: [`src/qa/acceptance.ts`](../apps/mobile/src/qa/acceptance.ts:409)
  checks package/app versions, `versionCode`, the EAS production APK profile,
  the CHANGELOG entry, the APK build id/commit/SHA-256, and the release record.
  Negative tests prove each mismatch fails closed (the old assertions were
  hardcoded `ok: true`).
- **M5.6** Executable release-readiness gate: [`src/qa/release.ts`](../apps/mobile/src/qa/release.ts:1)
  + `npm run release:check` (CI on GitHub and Gitea) validates
  [`docs/release.json`](release.json), the manifests, the tag, and rejects
  duplicate JSON keys.
- **M5.4** Device-run evidence pipeline: [`src/qa/device-run.ts`](../apps/mobile/src/qa/device-run.ts:1)
  + `npm run evidence:init` validates two devices, cold/warm/selector budgets,
  a ≥ 72 h crash-free soak, per-criterion evidence, and release identity, then
  renders `docs/04-device-evidence-<date>.md`. `docs/device-run.example.json`
  documents the schema and is rejected as evidence.
- Device-evidence strict validation now also rejects placeholder run metadata
  (`Date`, `Tester`, APK identity, commit) and an unconfirmed acceptance-report
  row.
- 27 new tests (`release.test.ts`, `device-run.test.ts`) plus criterion-7
  regression tests; suite now 222 tests, tsc and both CI backends green.

### Fixed
- `apps/mobile/app.json` had duplicate `splash` and `android.package` keys. The
  last `package` value (`com.anonymous.openrator`) silently overrode the
  intended `ai.openrator.app`. Duplicates removed; the new gate catches any
  recurrence.
- Restored the F-Droid app id `tech.alatcerdas.openrator` (v0.2.0 had reverted
  to `ai.openrator.app`, which blocked upgrades from v0.1.1).
- Removed the unsupported top-level `splash` and `notification` app-config
  properties so `expo prebuild` can generate the Android project on SDK 57.
- EAS production builds now pin Node `22.14.0` and the
  `ubuntu-24.04-jdk-17-ndk-r27b` image, and use `appVersionSource: "local"` so
  the tag's `versionCode` (3) is the versionCode embedded in the APK.

## [0.2.1] — 2026-11-01 — OpenCode Go live sync

### Added
- Branded launch screen generated from [`brand/svg/splash-screen.svg`](../brand/svg/splash-screen.svg)
  through the deterministic asset pipeline. `expo-splash-screen` now uses the
  OpenRator mark, wordmark, and tagline on the brand-blue (or ink in dark mode)
  background instead of the Expo scaffold.
- The top-level [`README.md`](../README.md) is now written for users only.
  Development setup, quality gates, release steps, and the documentation index
  moved to [`docs/07-development.md`](07-development.md) and
  [`docs/README.md`](README.md).

### Fixed
- OpenCode Go percentage windows now sync from the verified live API instead of
  requiring manual entry. The v0.2.0 artifact shipped the fixture-only adapter,
  which was the release gap this patch closes.

### Added
- **M8.1** OpenCode Go live transport: `OpenCodeGoAdapter` now calls
  `GET https://opencode.ai/zen/go/v1/usage` with the API key and maps
  `rolling`/`weekly`/`monthly` percentages plus `resetsAt` into plan windows.
  No workspace header is required; a `rate-limited` meter marks the plan
  `limited`.
- **M8.2** OpenCode Go (`opencode-go`) and OpenCode Zen (`opencode-zen`)
  descriptors with a documented capability matrix. Go exposes subscription
  percentage windows (5 h / weekly / monthly); Zen is pay-as-you-go reported in
  microcents and still uses the manual fallback until its balance endpoint is
  verified.
- **M8.3** Fixture-backed adapters: `OpenCodeGoAdapter` maps plan windows and
  clamps percentages; `OpenCodeZenAdapter` converts `MICROCENTS_PER_USD`
  (100,000,000) to USD before the value reaches SQLite or a screen.
- **M8.4** Capability-driven UI: Home renders a plan-window card (percent bars
  with warn/danger thresholds) and hides the credits card when no balance API is
  available; Spend shows an explainer + key windows for history-less providers;
  Keys/Policy keep their existing explainer gates.
- **M8.5** Manual fallback: `usage_manual` DAO (upsert/get/list/delete) plus an
  Accounts → **Manual tracking** card for month amount, Go plan name, and the
  three percentage windows. Every surface labels these values `user-entered`.
- **M8.7** Secrets guard now allows `openrouter.ai`, `stats.openrouter.ai`, and
  `opencode.ai` only.
- [`docs/05-provider-integrations.md`](05-provider-integrations.md) with units,
  capability matrix, manual fallback rules, and the M8.1 capture checklist.
- 8 new tests (`tests/opencode-providers.test.ts`); suite at 152 tests.

### Changed
- Accounts no longer asks for OpenCode Go percentage windows. The manual card
  for Go now records only the optional monthly dollar amount; percentages sync
  from the API. Tests cover URL/auth headers, window mapping, clamping,
  `rate-limited`, defensive parsing, and 401 propagation.

## [Unreleased] — M7 multi-provider core (v0.2)

### Added
- **M7.1–M7.2** Normalized provider domain model (`AccountSnapshot`,
  `UsageRecord`, `ProviderCapabilities`, `ProviderAdapter`) and a provider
  registry with capability-gated OpenRouter/OpenCode Zen descriptors.
- **M7.3** Shared HTTP core (`core/http.ts`) carrying timeout, single-flight,
  retry/backoff, and error mapping for every adapter; OpenRouter is the first
  adapter and existing client tests stay green.
- **M7.4** Namespaced secure credentials (`provider.<id>.key`, optional
  `provider.<id>.management_key`) with a one-time migration from the v0.1 key.
- **M7.5** SQLite migration v4: `provider` is part of the primary key for
  activity, rollups, keys, and provider snapshots; legacy rows copy as
  `openrouter`; new `usage_manual` table; provider-scoped settings.
- **M7.6** Per-provider sync orchestrator with independent failure isolation,
  capability gating, and per-provider staleness/status.
- **M7.7** Provider-aware onboarding, an Accounts pane (add/remove/sign out per
  provider), and adapter factory wiring.
- **M7.8** Home/Spend "All providers" scope plus a provider switcher;
  capability-gated Providers/Keys tabs show explainers rather than fake controls.
- **M7.9** Tests for v3→v4 migration, credential migration/namespacing,
  orchestrator failure isolation, aggregate math, and OpenRouter/Zen adapters.

## [Unreleased] — M6 brand system (v0.2)

### Added
- **M6.1–M6.8** Brand system: the approved eagle/chevron artwork is traced into
  a vector master and every app icon, adaptive/monochrome icon, splash, favicon,
  notification icon, lockup, wordmark, social preview, and release banner is
  generated from it.
- `brand/tokens.json` (palette, type, icon grid, provider monograms) and
  [`docs/06-brand-guide.md`](06-brand-guide.md).
- Deterministic pipeline: `scripts/brand/make-masters.mjs`,
  `scripts/brand/build-assets.mjs`, `npm run assets:build`, and
  `npm run assets:check` (CI drift gate on both GitHub and Gitea).
- In-app identity: generated [`BrandMark`](../apps/mobile/src/ui/brand-mark.tsx),
  SVG tab icon set, branded light/dark theme tokens, header mark, and onboarding
  hero.

## [WS2] — P1 robustness & UX

### Fixed
- **WS2-1** Admin-key wire contract aligned to the documented API: PATCH/DELETE use
  `/keys/{hash}` (not `{id}`) and create uses the `label` field (not `name`); added
  `include_byok_in_limit` to create/patch bodies. `AdminKey.id` is now optional.
- **WS2-7** Secure-store write failures are surfaced: `set()` throws instead of
  silently swallowing, so onboarding reports the error and does not advance.
- **WS2-10** EAS production build unblocked: the root `.gitignore` rule
  `apps/mobile/*.json` stripped `package.json`/`app.json`/`eas.json` from the build
  archive, failing `PRE_INSTALL_HOOK` ("package.json does not exist"). Rule removed;
  production APK now builds (build `e6e1199a…`, commit `805ac83`).

### Changed
- **WS2-2** Batched DB writes (`upsertActivityRows`, `replaceDailyRollups`, provider
  upsert) now run inside a single transaction — all-or-nothing on mid-batch failure.
- **WS2-3** Versioned migrations via `PRAGMA user_version` with an ordered migration
  list (base schema → `usage_weekly` → provider `state`); deterministic upgrades.
- **WS2-4** Onboarding screen themed with `useTheme()` tokens (dark-mode correct).
- **WS2-5** Charts are responsive: `ResponsiveAreaChart` measures its container and
  the provider-share donut sizes to the available row width.
- **WS2-6** Added a themed error boundary with a recoverable "Reload" action.
- **WS2-8** Preset routing writes are double-confirmed via `Alert.alert` (spec §10).
- **WS2-9** Provider health is persisted (`last_ok_at` + `state`) and rendered as a
  health dot on the Home strip, alongside the status-page link.

### Developer
- 100 unit/integration tests (added atomicity, v1→latest migration, provider-health,
  admin-key contract, and secure-store-failure cases).

## [0.1.0] — 2026-10-06 — v0.1 feature-complete
Android app (Expo/React Native SDK 57, Expo Go) — single-pane OpenRouter dashboard.

### Added (M0–M5)
- **Onboarding**: paste key (format-gated, paste-warn), management-key toggle, secure-store
  persistence (expo-secure-store); clear-stored-key sign-out (double-confirmed).
- **Home**: credits/balance, key card (label, mgmt badge, limit/remaining + reset,
  usage today/week/month, expiry), 30-day activity window state, refresh + stale badges.
- **Spend & Endpoint analytics** (mgmt key): 30-day spend area chart (7/14/30), totals,
  endpoint breakdown by spend/requests with provider status links, provider-share donut;
  no-mgmt fallback (key spend windows) + explainer; offline renders stale cache.
- **Providers**: catalog (search, sort by name/region, region chips, status-page links);
  policy editor — select preset → per-provider routing state (`provider.only/order/ignore`),
  tap-to-cycle writes a new preset version (cost-free API trick), optimistic UI + rollback +
  version guard, account-wide prefs reflection + dashboard deep-links.
- **Keys**: current-key card; mgmt-gated list CRUD (rename, limit/reset, expiry, revoke
  double-confirmed); create-key flow with show-once reveal + copy + live /key test,
  secret never persisted (reveal-later state machine).
- **Resilience**: single-flight HTTP client, retry/backoff (429/5xx + Retry-After), typed
  error taxonomy (401/402+remedy/403/404/429), 30-day activity cache + retention pruning,
  idempotent SQLite migrations.
- **Security**: key only in Android keystore; static secrets guard in CI; no analytics SDK;
  network whitelist (openrouter.ai only).

### Fixed during M5 QA hardening
- `limit` reserved-word crash in schema/`upsertKeyRow` (caught by node:sqlite E2E).
- `undefined` binding in `upsertKeyRow` when `/key` omits optional fields.
- Reporter-tooling: crash core-dump artifact removed + gitignored.

### Developer
- 89 unit/integration tests; Gitea Actions CI (vitest → tsc → android export) on every push.

### Known / deferred
- `/activity` exact wire shape provisional until a mgmt-key device pass (M0.5A).
- EAS app build + device QA matrix: docs/04-qa-checklist.md (Sam-executed).
- Preset/key **delete** intentionally dashboard-only (API has no key-delete surface for
  presets; keys revoke supported).