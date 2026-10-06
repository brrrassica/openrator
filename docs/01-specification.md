# OpenRator — Product Specification

**Status:** Draft v0.1.0 · **Date:** 2026-10-05 · **Author:** PT Alat Cerdas (product/BD)
**API surface verified against:** openrouter.ai/docs (llms.txt + OpenAPI reference pages) on 2026-10-05.

---

## 1. Problem statement

Users of OpenRouter (developers, tinkerers, small teams) currently have to open
`openrouter.ai` in a browser to answer basic questions that they otherwise ask
constantly:

- "How many credits do I have left, and when does my key limit reset?"
- "What did I spend today / this week / this month, on which models and providers?"
- "Which upstream providers are active for my account, and are any of them failing?"
- "Which API keys exist, what limits do they have, and where is spend happening?"

There is **no first-class Android client** for this. The OpenRouter mobile web
experience is a reskin of the desktop dashboard, not a focused, on-the-go,
read-and-control surface. The goal of v0.1 is a **single-pane-of-glass Android
app**: credits at a glance, spend & endpoint analytics you can actually browse,
and upstream provider status + controls — all from one React codebase.

> **Pivot (2026-10-05, verified live):** per-request generation history is **not
> exposed** by the public API — `GET /generation` now requires an `id` and there
> is no paginated list endpoint (§5.3). v0.1 therefore ships **Spend & Endpoint
> analytics** (30-day endpoint activity via `/activity`, key spend windows via
> `/key`, `/credits`) instead of a per-request usage log.

## 2. Goals (v0.1)

1. **Credits at a glance** — account + per-key credits, spend windows (daily /
   weekly / monthly), limit remaining, key expiry, free-model daily quota.
2. **Spend & endpoint analytics** — 30-day spend/requests by endpoint
   (model+provider) and by day, key spend windows (daily/weekly/monthly), and
   on-device rollups (per-day/per-endpoint) — fed by `GET /activity` (mgmt key)
   + `GET /key`; per-request generation logs are out of v0.1 (not exposed by the
   public API).
3. **Provider status + controls** — catalog of upstream providers with an
   enabled/disabled posture, routing policy editor (via Presets), and clear
   deep-links to dashboard-only settings.
4. **Keys oversight** — list keys, view limits, edit label/limit/reset window,
   revoke, and create (management-key optionally).
5. **Privacy-first key handling** — BYOK: the user's OpenRouter key never leaves
   the device; stored in Android secure storage, used only for direct API calls.

## 3. Non-goals (explicitly out of v0.1)

- Chat completions / an AI chat client (v0.2+ candidate).
- iOS support (same Expo codebase makes it a stretch goal, not v0.1).
- Push notifications / background alerts (requires a backend; v0.2 candidate).
- Multi-account, organizations, workspaces, team features (v0.2+).
- OAuth login to OpenRouter (v0.2+; needs web redirect flow).
- Account-wide provider toggles that the API cannot express (see §6.3).

## 4. Personas

- **Primary — Solo operator (Sam-like):** runs several OpenRouter keys across
  tools (clients, agents, homelab). Wants a 5-second glance + quick spend check
  from the phone, plus the ability to clamp a key limit without logging into web.
- **Secondary — Small-team lead:** watches spend across keys, wants cost + model
  breakdowns, wants to enforce "no rogue providers" by editing routing policy.

## 5. Verified API surface (2026-10-05)

> Source: OpenRouter docs & OpenAPI reference blocks, **verified against a live
> standard key on 2026-10-05** (roadmap M0 spikes; details in
> `docs/03-spike-notes.md`).

### 5.1 Credits & key status — no management key needed
| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/v1/key` (a.k.a. `/auth/key`) | any key | `label`, `limit`, `usage`, `usage_daily|weekly|monthly`, `limit_remaining`, `limit_reset` (`daily|weekly|monthly|null`), `byok_usage*`, `is_free_tier`, `is_management_key`, `free_model_daily_requests {used,limit,remaining}`, `expires_at`, `allowed_data_regions`, `workspace_id`, `organization_id` |
| `GET /api/v1/credits` | any key *(verified 2026-10-05)* | `total_credits`, `total_usage` (account balance). Docs mark it management-only, but a standard key returned 200 live — ship as a benefit that degrades gracefully on 403. |

### 5.2 Management-key-gated endpoints (v0.1: display gracefully when unavailable)
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/keys` / `PATCH /keys/{hash}` / `DELETE /keys/{hash}` / `POST /key` | key CRUD; PATCH body: `label`, `limit`, `limit_reset`, `include_byok_in_limit`, `expires_at` |
| `GET /api/v1/activity` | 30-day endpoint activity; filters `date`, `api_key_hash`, `user_id`, `group_by=workspace` |
| `POST /generation/{id}/feedback` | structured feedback (nice-to-have) |

### 5.3 Usage analytics (post-pivot; verified 2026-10-05)
| Endpoint | Notes |
|---|---|
| `GET /api/v1/activity` | **Replaces the generation list.** 30-day endpoint activity; filters `date`, `api_key_hash`, `user_id`, `group_by=workspace`. **Management-key only** (standard key → 403, verified). Exact response shape to be captured with a management key (M0.5A follow-up); type defensively. |
| `GET /api/v1/generation` (list) | **Not public** — `400 id: Invalid input` (verified, incl. `?limit=`/`?cursor=` variants). No public list endpoint exists (`/generations`, `/usage` → 404). Per-request history is dashboard-internal for v0.1. |
| `GET /api/v1/generation/{id}` | Per-generation metadata, only if the client already holds an id from its own call — **not enumerable**; not used in v0.1. |

### 5.4 Providers & models
| Endpoint | Notes |
|---|---|
| `GET /api/v1/providers` | Read-only catalog: `name`, `slug`, `headquarters`, `datacenters[]`, `privacy_policy_url`, `status_page_url`, `terms_of_service_url` |
| `GET /api/v1/models/user` | Models filtered by **user provider preferences, privacy settings, guardrails** — read-only reflection of the user's effective routing policy |
| `GET /api/v1/models/{author}/{slug}/endpoints` | Per-endpoint detail (status/pricing) for a model |

### 5.5 Presets — the *control* surface for provider policy
| Endpoint | Notes |
|---|---|
| `POST /api/v1/presets` (from chat-completions / messages / responses body), `GET /api/v1/presets` (list), `GET /api/v1/presets/{slug}`, version history | Presets persist **provider routing rules** (`provider: {only|order|ignore|sort}`), model, params. Referenced by clients via `X-OpenRouter-Preset: @preset/{slug}` or `@preset/{slug}` as model. Effect is scoped to consumers that use the preset — **not** account-wide. |

### 5.6 Error semantics (drives app UX)
- `402` → `error.metadata.limit_source` ∈ `openrouter_key_limit` | `openrouter_credits` | `openrouter_in_flight_budget`; `remedy_hint`; honor `Retry-After`.
- `429` → rate limited (platform or upstream provider); `X-RateLimit-*` headers; exponential backoff.
- `403` on management-key endpoints → app shows "add a management key to unlock" state.

## 6. Constraints & design consequences

### 6.1 "Android app based on React" ≠ plain React
React renders in a browser; it is not a native Android runtime. To deliver a
real **Android app in React** you ship **React Native**, and the pragmatic path
is **Expo** (managed build → Android APK, easy dev loop). Alternatives:
React **PWA** (installable web app, zero app-store, but weaker than native for
this use), or Flutter (not React — out). **Decision D1.**

### 6.2 Key handling: BYOK on-device (no backend in v0.1)
- Key stored via Android secure keystore; sent only to `openrouter.ai` over TLS.
- No telemetry, no server, no account/cloud DB.
- Consequence: push notifications, cross-device sync, and management-key
  convenience are **postponed** to a v0.2 thin-backend option. **Decision D2.**

### 6.3 Provider "enable/disable" — the honest model
There is **no public API to flip account-wide provider switches** (that lives in
dashboard *Settings → Privacy*). What *is* possible:
1. **Routing policy via Presets** (API-manageable): the app's toggles edit the
   `provider.ignore` / `provider.only` lists of a user-selected preset, giving
   users a real "default provider policy" they control from the phone — with a
   clear label that it applies to clients using that preset.
2. **Read-only reflection** of account-wide prefs via `GET /models/user`.
3. **Deep-link** to `https://openrouter.ai/settings/privacy` for the
   account-wide toggle with an in-app explainer.
v0.1 implements 1+2+3, presenting the provider screen as *"Provider policy"* (not
a fake global switch). **Decision D3.**

## 7. Architecture (v0.1)

```
┌───────────────────────── Android device (Expo / React Native) ─────────┐
│ Screens: Home Pane · Usage · Provider Policy · Keys                    │
│   ▲▼                                                                   │
│ App services: OpenRouterClient (fetch), Credentials (keystore),        │
│   SyncEngine (poll + incremental), UsageStore (SQLite), Notifier(state)│
│   ▲▼                                                                   │
│ SQLite on-device DB: usage_history, daily_rollups, provider_snapshot   │
└────────────────────────────────────────────────────────────────────────┘
        │ HTTPS (Bearer key)                      │
        ▼                                        ▼
  openrouter.ai/api/v1                    provider status pages
  /key /credits /activity* /providers     (status_page_url, read-only)
  /keys* /providers /models/user
  /presets/**                        (* = mgmt key)
```

- **Polling cadence:** credits (`/key` + `/credits`) every 60 s while app
  foreground / 15 min in background; **activity pull on open + every 15 min**
  (when a management key is present); provider snapshot + `/models/user` cache
  daily.
- **Charts:** light-weight custom SVG (no heavy web chart libs) — bar/area for
  spend, donut for provider share.
- **Concurrency:** one in-flight OpenRouter request at a time per key; small
  shared response cache with `ETag`-style `If-None-Match` where supported.
- **Offline behavior:** last-known values always renderable; "stale" badge.

## 8. Screens & functional spec (v0.1)

### 8.1 Home Pane (single pane of glass)
- Header: account balance card — credits remaining (key limit), `limit`/`limit_remaining`,
  `limit_reset` chip, spend today/week/month, free-model daily quota bar.
- Spend trend: last 14 days area chart (USD), cached in rollups.
- Top models / top providers (last 7 days) with share bars.
- Key warning row: `limit_remaining` < 10% · key near `expires_at` ·
  `usage_daily` spike · management-key endpoints locked.
- Upstream health strip: enabled providers with last-known `state`/status page
  link; pull-to-refresh.

### 8.2 Spend & Endpoint Analytics (pivoted from Usage Log)
- **30-day spend chart** (area) + total requests, from `/activity` where a
  management key is configured; endpoints grouped as model+provider pairs.
- **Endpoint breakdown:** rank by spend / requests, with day filter; each row
  links to the provider's status page (from `/providers`) where available.
- **No mgmt key:** show the explainer card ("add a management key to unlock
  30-day analytics") + key spend windows from `/key` as the fallback view.
- Rollups tab: by day / by endpoint (local aggregation of activity rows).
- Retention: 30-day window from API; on-device cache pruned beyond 35 days.

### 8.3 Provider Policy
- Provider catalog (search/sort): name, slug, datacenter regions, status page link.
- "Policy" view: which providers are **included/ignored/prioritized** in the
  selected preset (`provider.only/order/ignore`) + what account-wide prefs say
  (read-only, via `/models/user`), with "manage globally →" deep-link.
- Toggle = edit preset routing rule (optimistic UI + rollback on failure).

### 8.4 Keys
- Current key card (never shows full secret) + key list (mgmt key).
- Actions: rename, set/change `limit` + `limit_reset`, `include_byok_in_limit`,
  `expires_at`, revoke; create new key (labeled).
- Per-key usage when mgmt key present.

## 9. Data model (SQLite, on-device)

| Table | Key fields |
|---|---|
| `keys` | hash, label, limit, limit_remaining, usage*, reset, expires_at, is_management |
| `endpoint_activity` | (day, endpoint, api_key_hash) PK, day, endpoint, api_key_hash, requests, spend_usd, tokens |
| `daily_rollups` | day PK, spend_usd, requests, tokens, by_model JSON, by_provider JSON |
| `provider_snapshot` | slug PK, name, regions, status_page, last_ok_at, policy (only/order/ignore per preset) |
| `settings` | kv: preset_slug_selected, poll intervals, onboarding_done |

## 10. Security, privacy, resilience

- Key only in Android keystore; memory-buffer hygiene; paste-warn dialog.
- No analytics SDK, no crash-reporting with payloads, no third-party network
  calls besides OpenRouter + provider status pages.
- TLS pinning best-effort; validate `openrouter.ai` cert chain (default).
- Handle 401 (bad key), 402 (credits — with remedy_hint), 429 (backoff),
  403 (mgmt gated), 5xx (retry + stale badge) — each with a friendly state.
- All writes to Presets API are double-confirmed in UI (destructive = revoke
  key, delete preset).

## 11. v0.1 acceptance criteria

1. Fresh install → enter key → Home Pane populated < 10 s (warm cache < 2 s).
2. Spend trend + top models/providers match dashboard within tokenization winks
   (≤5% known-cost variance acceptable, documented).
3. Spend & endpoint analytics match the dashboard's 30-day activity figures
   (with mgmt key); without one, fallback view + explainer; offline shows stale.
4. Provider toggle on a preset changes `provider.ignore` on OpenRouter and reads
   back correctly; UI rollback on failure.
5. Key edit/revoke works and reflects on dashboard immediately.
6. No credential ever leaves device except TLS to `openrouter.ai`.
7. Passes Expo Android build; installs on Android 12+ (target) without crash.

## 12. Significant decisions — status 2026-10-05 (confirmed by Sam)
| # | Decision | Status | Final |
|---|---|---|---|
| D1 | Stack | ✅ confirmed | Expo (React Native) — true Android app from a React/TS codebase |
| D2 | Backend/key model | ✅ confirmed | BYOK on-device, no backend in v0.1; backend revisited for v0.2 (alerts/sync) |
| D3 | Provider controls scope | ✅ confirmed | Presets-based policy editor + read-only `/models/user` reflection + deep-link to Settings→Privacy |
| D4 | Product intent | ✅ confirmed | Personal/internal tool first; productize after v0.2 validation |
| D5 | Name/branding | ✅ confirmed 2026-10-05 | **OpenRator** (OpenRouter + curator) — branding/marketing still deferred until productize decision |
| D6 | iOS parity | ✅ confirmed | Out of v0.1 (same codebase keeps it cheap later)
| D7 | Usage feature scope | ✅ confirmed 2026-10-05 (post-spike) | **Spend & Endpoint analytics** via `/activity` (mgmt key) + `/key`/`/credits`; per-request generation logs out of v0.1 (public API exposes no list) |

## 13. Spike answers & remaining questions (2026-10-05)

**Answered (live, standard key):**
1. `GET /generation` list → **not public** (400 requires `id`); no list.
2. Per-generation content → untestable without an id; not needed in v0.1.
3. Presets → create/update/version via `POST /presets/{slug}/chat/completions`
   (cost-free, config incl. `provider.ignore` persisted); list/get/versions OK;
   **delete is dashboard-only** (all API delete variants 404).
4. `/models/user` → 200, 282 models for this account, `total_count`+`links`
   pagination; includes `top_provider`; no per-endpoint breakdown (use
   `/models/{author}/{slug}/endpoints` where needed).
5. Secure storage → **expo-secure-store** (hardware-backed where available,
   encrypted fallback) for keys; **expo-sqlite** for cache; key never in SQLite.

**Remaining (track at M0.5A when a management key is available):**
- Exact `/activity` response shape (fields, pagination, endpoint representation)
  — the v0.1 type is provisional until captured.
- Whether `/credits` stays open to standard keys (docs say mgmt-only; observed
  200 on 2026-10-05) — handle both outcomes.
- Device QA of expo-secure-store on Android 12+ (fallback behavior).