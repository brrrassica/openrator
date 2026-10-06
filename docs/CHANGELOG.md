# Changelog

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