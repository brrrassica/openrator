# Changelog

## [Unreleased] — WS2 (P1 robustness & UX)

### Fixed
- **WS2-1** Admin-key wire contract aligned to the documented API: PATCH/DELETE use
  `/keys/{hash}` (not `{id}`) and create uses the `label` field (not `name`); added
  `include_byok_in_limit` to create/patch bodies. `AdminKey.id` is now optional.
- **WS2-7** Secure-store write failures are surfaced: `set()` throws instead of
  silently swallowing, so onboarding reports the error and does not advance.

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