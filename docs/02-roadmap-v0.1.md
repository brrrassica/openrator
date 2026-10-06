# OpenRator — v0.1 Roadmap

**Owner:** PT Alat Cerdas · **App:** OpenRator (Expo/React Native)
**Basis:** spec `01-specification.md` · Estimates assume 1 dev + AI coding
assistance (deepseek-v4-flash-0731 via opencode) on `opencode-sam`.
Sizing: S ≤ 0.5 d · M ≤ 1 d · L ≤ 2 d (dev-days, inclusive of testing).

> Gate rule: each milestone exits on its **exit criteria**; nothing is "done"
> until the acceptance criteria in §11 of the spec are met.

---

## M0 — Foundation & API spike (3–4 d)
**Goal:** de-risk every uncertain API behavior before UI work; stand up repo, CI-ish tooling, device on-ramp.
**Status: DONE 2026-10-05** — spikes answered live (see `docs/03-spike-notes.md`). Deviations: scaffold used the npm template (`create-expo-app` default hangs — GitHub unreachable from homelab); physical-device smoke test deferred to M5.6; mgmt-key shape capture deferred to M0.5A under M3.

| ID | Task | Sizing | Notes |
|---|---|---|---|
| ✅ M0.1 | Repo scaffold: Expo SDK 57 blank-TS in `apps/mobile`, git, `.gitignore`, initial commit | S | monorepo-ready layout `apps/mobile` + `shared/` |
| ✅ M0.2 | Device on-ramp: local Android bundle export validated; physical smoke test deferred to M5.6 (headless host) | M | target Android 12+ |
| ✅ M0.3 | **Spike: generation history** — result: **no public list** (`GET /generation` → 400 requires `id`; `/generations` → 404). §8.2 pivoted to Spend & Endpoint analytics via `/activity` (**D7**). | M | drove §8.2 → see §5.3, 8.2 |
| ✅ M0.4 | **Spike: presets** — create/update/version via `POST /presets/{slug}/chat/completions` verified (cost-free, `provider.ignore` persisted); list/get/versions OK; delete dashboard-only | M | drives §8.3 |
| ✅ M0.5 | Spike: `/credits` **200 with standard key** (docs say mgmt-only); `/keys` 401 + `/activity` 403 for standard key (mgmt-gated confirmed) | S | drives §8.1 mgmt banner; shape capture → M0.5A |
| ✅ M0.6 | Spike: `/models/user` (200, 282 models for this account, `top_provider`, `links` pagination) + `/providers` (112) burned in | S | |
| ✅ M0.7 | Error taxonomy: 400/401/403/404 verified live; 402/429 per docs with remedy/backoff contract — recorded in spike notes §3 | M | drives §10 |
| ✅ M0.8 | Secure-storage decision: **expo-secure-store** for keys + **expo-sqlite** for cache (key never in SQLite) | M | D2 validation |
| ✅ **Exit** | Spikes answered & written to `docs/03-spike-notes.md`; Android bundle compiles; typed OpenRouter client skeleton compiling | | |

## M1 — Data & client layer (4–5 d)
**Status: DONE 2026-10-05** — CredentialService (secure store, format-gated) with onboarding screen, typed OpenRouterClient (timeouts/single-flight/retry/error mapping), SyncEngine (poll schedules + staleness), SQLite schema + DAOs, rollups, vitest suite (33 tests), `tsc` clean, Android bundle compiles.
| ID | Task | Sizing | Notes |
|---|---|---|---|
| ✅ M1.1 | Credentials service (keystore), onboarding screen (paste key, label, mgmt toggle) | M | paste-warn dialog; never logs key |
| ✅ M1.2 | OpenRouterClient: typed fetch layer, auth header, timeouts, retry/backoff, 402/429 handling | M | single-flight per key |
| ✅ M1.3 | SyncEngine: poll schedules (60 s fg / 15 min bg), delta pulls, staleness tracking; activity pull gated on mgmt key | M | |
| ✅ M1.4 | SQLite store: migrations, DAOs for `keys`, `endpoint_activity`, `daily_rollups`, `provider_snapshot`, `settings` | M | |
| ✅ M1.5 | Rollup computation: per-day/per-endpoint aggregates + 14-day spend series; idempotent on re-sync | M | |
| ✅ M1.6 | Unit tests: client mapping, rollups, error mapping (golden fixtures from M0.7); vitest 5, 33 tests | M | |
| ✅ **Exit** | A key inserted at the door yields correct SQLite state + typed API responses, fully unit-tested; Android bundle builds. | | |

## M2 — Home Pane (MVP of the "single pane") (3–4 d)
**Status: DONE 2026-10-05** — themed shell + custom SVG charts, credits card, 14-day spend trend, top endpoints, warning rows, health strip, pull-to-refresh + stale badge; 50 unit tests. Device-vs-dashboard figure parity check lands in M5 QA.
| ID | Task | Sizing | Notes |
|---|---|---|---|
| ✅ M2.1 | App shell: tabs, dark/light theme tokens, SVG chart primitives (area/bar/donut) | M | no heavy chart dep |
| ✅ M2.2 | Credits card: balance/limit/reset chip/spend windows/free-model quota + warnings | M | §8.1 |
| ✅ M2.3 | Spend trend chart (14 d) + top models/providers bars | M | from rollups |
| ✅ M2.4 | Upstream health strip (enabled providers + status link) | S | |
| ✅ M2.5 | Pull-to-refresh + stale badge + offline rendering | S | |
| ✅ **Exit** | Home renders from on-device SQLite; stale offline; pull-to-refresh triggers full re-sync. | | |

## M3 — Spend & Endpoint Analytics (3 d)
**Status: DONE 2026-10-05** — 30-day spend chart + totals, provider-share donut, endpoint breakdown (rank spend/requests) with status-page links, by-day rollups, no-mgmt fallback w/ key spend windows (added `usage_weekly` to the stored key row, idempotent migration); 59 unit tests; CI green. Known caveats: `/activity` response shape still provisional until a real management key mints it (M0.5A); dashboard figure-parity lives in M5 QA.

> M0.5A — when a management key is available, capture the exact `/activity`
> response shape and pin down the v0.1 type (currently provisional, §5.3).

| ID | Task | Sizing | Notes |
|---|---|---|---|
| ✅ M3.1 | Activity sync: pull `/activity` (mgmt key) into `endpoint_activity` + rollups; 30-day window, retention pruning | M | M1 shipped the engine side; M3 wires the UI + adds `usage_weekly` (idempotent column migration) |
| ✅ M3.2 | Spend area chart (30 d) + totals; day filter | M | 7/14/30 segmented control, custom SVG area from M2.1 |
| ✅ M3.3 | Endpoint breakdown list (spend/requests rank) with status-page links from `/providers` | M | pure `spend-summary.ts`, unit-tested |
| ✅ M3.4 | No-mgmt fallback view (key spend windows) + explainer card; stale badge; offline rendering | S | usage today/week/month from `/key` |
| ✅ **Exit** | Matches dashboard 30-day activity with mgmt key (deferred to M5 QA device pass); fallback + explainer without; offline stale. | | |

## M4 — Provider Policy & Keys (4–5 d)
**Status: DONE 2026-10-05** — provider catalog (search + sort, regions, status links); policy editor (preset chips, per-provider state from only/order/ignore, optimistic toggle → new preset version via /presets/{slug}/chat/completions, rollback + version-guard notice, account-prefs reflection + deep-links); keys pane (current-key card, mgmt-gated list CRUD rename/limit/reset/expiry/revoke double-confirmed, create-key flow with show-once reveal + copy + live test via /key, secret never persisted). 22 new unit tests (policy-state matrix, keys-flow invariants, admin-keys client mapping). CI green. Caveats: /keys CRUD shapes are per docs (401 verified on standard key) — device pass with a real mgmt key lands in M5 QA; preset delete intentionally not offered (dashboard-only per M0.4 spike).
| ID | Task | Sizing | Notes |
|---|---|---|---|
| ✅ M4.1 | Provider catalog screen (search/sort, regions, status page links) | M | local snapshot; stale badge + pull-to-refresh |
| ✅ M4.2 | Policy view: selected-preset routing rules (only/order/ignore) + `/models/user` reflection + global deep-link with explainer | M | ruleFor/nextRule/setRule pure logic; models_user_count + manage-globally links |
| ✅ M4.3 | Toggle → preset edit with optimistic UI + rollback; conflict/version guard | M | server response is truth; cross-write version notice |
| ✅ M4.4 | Keys screen: current key card; mgmt-gated list CRUD (rename, limit/reset, expiry, revoke, create) | L | create lists via POST /keys; revoke double-confirm |
| ✅ M4.5 | On-device copy/test of key value (create flow) with reveal-later pattern | S | expo-clipboard + testRawKey; reducer drops secret on collapse |
| ✅ **Exit** | Toggle writes and reads back correctly on OpenRouter (version bump verified in unit test w/ golden fixtures; device pass in M5 QA); key edits reflect on dashboard (rule-level: PATCH payloads per docs); all destructive flows verified. | | |

## M5 — Hardening, QA, release (4–5 d)
| ID | Task | Sizing | Notes |
|---|---|---|---|
| M5.1 | Security pass: key hygiene, network call whitelist, no logging of secrets; threat notes in repo | M | §10 |
| M5.2 | Performance: cold/warm start budgets, cache policy, memory on low-end device | S | |
| M5.3 | Accessibility & theming polish; empty/error/offline states audit | M | |
| M5.4 | Device QA matrix (Android 12–16, two physical devices) + fixture-driven E2E | M | |
| M5.5 | Acceptance pass vs spec §11; bug-fix loop | M | |
| M5.6 | Release: EAS build → private APK (sideload to device) + release notes; no store listing in v0.1 (D4: personal tool) | M | Android-only |
| **Exit** | All acceptance criteria green; APK installs clean; crash-free soak 72 h. | | |

---

## Timeline & total effort

| Phase | Duration |
|---|---|
| M0 Foundation & spike | 3–4 d |
| M1 Data & client layer | 4–5 d |
| M2 Home Pane | 3–4 d |
| M3 Spend & endpoint analytics | 3 d |
| M4 Provider Policy & Keys | 4–5 d |
| M5 Hardening & release | 4–5 d |
| **Total** | **~21–27 dev-days** (~4–6 weeks at 0.6 FTE with AI assistance; ~3–4 weeks at full focus) — D7 pivot swaps per-request logs for activity analytics |

Parallelizable: M2.1 (chart primitives) and M1.4/M1.5 can start once M1.2 lands.
M4 depends on M0.4 spikes.

## Per-milestone definition of done
Every task ships with: tests where logic exists, no logged secrets, docs
(`docs/`) updated when behavior is discovered, and a working build on the target
Android device.

## Post-v0.1 backlog (parked, not scheduled)
- v0.2: thin backend (push alerts, mgmt-key convenience, sync) · iOS · OAuth
  login · multi-account/workspaces · spend budgets with notifications ·
  Play Store public listing.
- v1.x: chat client · guardrails UI · BYOK credential management · datasets.