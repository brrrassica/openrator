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

| ID | Task | Sizing | Notes |
|---|---|---|---|
| M0.1 | Repo scaffold: `npx create-expo-app` (TS template), git, linter, formatting, pre-commit | S | monorepo-ready layout `apps/mobile` + `shared/` |
| M0.2 | Device on-ramp: EAS/Android emulator + physical device smoke test ("hello") | M | target Android 12+; document Expo Go vs dev build |
| M0.3 | **Spike: generation history** — call `GET /generation` with a real key; confirm pagination (limit/cursor, has_more), rate limits, and payload fields vs §5.3 | M | drives §8.2 design |
| M0.4 | **Spike: presets** — CRUD a throwaway preset with `provider.ignore`; verify list/update/version semantics + propagation to `X-OpenRouter-Preset` consumer | M | drives §8.3 |
| M0.5 | Spike: `/credits`, `/keys`, `/activity` with a management key; capture 403 behavior for standard key | S | drives §8.1 mgmt banner |
| M0.6 | Spike: `/models/user` shape + latency; `/providers` fully burned in | S | |
| M0.7 | Error taxonomy harness: fixture server or recorded responses for 401/402/429/403/5xx; typed client errors | M | drives §10 |
| M0.8 | Secure-storage decision: Android keystore vs encrypted app storage; spike both | M | D2 validation |
| **Exit** | All spikes answered and written to `docs/03-spike-notes.md`; app builds to device; typed OpenRouter client skeleton compiling. | | |

## M1 — Data & client layer (4–5 d)
| ID | Task | Sizing | Notes |
|---|---|---|---|
| M1.1 | Credentials service (keystore), onboarding screen (paste key, label, mgmt toggle) | M | paste-warn dialog; never logs key |
| M1.2 | OpenRouterClient: typed fetch layer, auth header, timeouts, retry/backoff, 402/429 handling | M | single-flight per key |
| M1.3 | SyncEngine: poll schedules (60 s fg / 15 min bg), delta pulls, staleness tracking | M | |
| M1.4 | SQLite store: migrations, DAOs for `keys`, `generations`, `daily_rollups`, `provider_snapshot`, `settings` | M | |
| M1.5 | Rollup computation: day/model/provider/app aggregates + 14-day spend series; idempotent on re-sync | M | |
| M1.6 | Unit tests: client mapping, rollups, error mapping (golden fixtures from M0.7) | M | |
| **Exit** | Hey: a key inserted at the door yields a correct SQLite state and typed API responses, fully unit-tested. | | |

## M2 — Home Pane (MVP of the "single pane") (3–4 d)
| ID | Task | Sizing | Notes |
|---|---|---|---|
| M2.1 | App shell: tabs, dark/light theme tokens, SVG chart primitives (area/bar/donut) | M | no heavy chart dep |
| M2.2 | Credits card: balance/limit/reset chip/spend windows/free-model quota + warnings | M | §8.1 |
| M2.3 | Spend trend chart (14 d) + top models/providers bars | M | from rollups |
| M2.4 | Upstream health strip (enabled providers + status link) | S | |
| M2.5 | Pull-to-refresh + stale badge + offline rendering | S | |
| **Exit** | Home matches dashboard figures (verified against a real account); renders stale offline; pull-to-refresh works. | | |

## M3 — Usage Log (3–4 d)
| ID | Task | Sizing | Notes |
|---|---|---|---|
| M3.1 | Paginated list w/ filters (model, provider, app, range) + infinite scroll | M | |
| M3.2 | Generation detail view + deep-link to dashboard | S | |
| M3.3 | Rollups tab (day/model/provider/app) with charts | M | |
| M3.4 | Incremental sync of new generations + retention cleanup setting | M | |
| **Exit** | ≥ 7 days of history browsable; filters correct; rollups equal local aggregation of rows. | | |

## M4 — Provider Policy & Keys (4–5 d)
| ID | Task | Sizing | Notes |
|---|---|---|---|
| M4.1 | Provider catalog screen (search/sort, regions, status page links) | M | |
| M4.2 | Policy view: selected-preset routing rules (only/order/ignore) + `/models/user` reflection + global deep-link with explainer | M | D3 |
| M4.3 | Toggle → preset edit with optimistic UI + rollback; conflict/version guard | M | |
| M4.4 | Keys screen: current key card; mgmt-gated list CRUD (rename, limit/reset, expiry, revoke, create) | L | destructive ops double-confirm |
| M4.5 | On-device copy/test of key value (create flow) with reveal-later pattern | S | |
| **Exit** | Toggle writes and reads back correctly on OpenRouter; key edits reflect on dashboard; all destructive flows verified. | | |

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
| M3 Usage Log | 3–4 d |
| M4 Provider Policy & Keys | 4–5 d |
| M5 Hardening & release | 4–5 d |
| **Total** | **~21–27 dev-days** (~4–6 weeks at 0.6 FTE with AI assistance; ~3–4 weeks at full focus) |

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