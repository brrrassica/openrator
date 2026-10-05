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
app**: credits at a glance, usage history you can actually browse, and upstream
provider status + controls — all from one React codebase.

## 2. Goals (v0.1)

1. **Credits at a glance** — account + per-key credits, spend windows (daily /
   weekly / monthly), limit remaining, key expiry, free-model daily quota.
2. **Browsable usage logs** — recent generations with model, provider, tokens,
   cost, latency, and per-day/per-model/per-provider rollups on-device.
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

> Source: OpenRouter docs & OpenAPI reference blocks. Verify each against a live
> key in **Spike 0** (roadmap §M0) before coding — especially generation-list
> pagination and preset edit semantics.

### 5.1 Credits & key status — no management key needed
| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/v1/key` (a.k.a. `/auth/key`) | any key | `label`, `limit`, `usage`, `usage_daily|weekly|monthly`, `limit_remaining`, `limit_reset` (`daily|weekly|monthly|null`), `byok_usage*`, `is_free_tier`, `is_management_key`, `free_model_daily_requests {used,limit,remaining}`, `expires_at`, `allowed_data_regions`, `workspace_id`, `organization_id` |

### 5.2 Management-key-gated endpoints (v0.1: display gracefully when unavailable)
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/credits` | `total_credits`, `total_usage` (account balance) |
| `GET /api/v1/keys` / `PATCH /keys/{hash}` / `DELETE /keys/{hash}` / `POST /key` | key CRUD; PATCH body: `label`, `limit`, `limit_reset`, `include_byok_in_limit`, `expires_at` |
| `GET /api/v1/activity` | 30-day endpoint activity; filters `date`, `api_key_hash`, `user_id`, `group_by=workspace` |
| `POST /generation/{id}/feedback` | structured feedback (nice-to-have) |

### 5.3 Usage logs (generation history)
| Endpoint | Notes |
|---|---|
| `GET /api/v1/generation` | List generation history. **Pagination + filter semantics to confirm in Spike 0** (dashboard uses `limit`/`cursor`-style pages; docs do not fully spec a public list method). |
| `GET /api/v1/generation/{id}` | Per-generation metadata: `id`, `created_at`, `generation_time`, `model`, `provider_name`, `native_tokens_prompt|completion|reasoning|cached`, `tokens_prompt|completion`, `total_cost`, `upstream_inference_cost`, `state`, `app_id` |
| `GET /api/v1/generation/{id}/content` | Stored prompt/completion/error (privacy-gated; verify availability) |

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
  /key /credits* /generation              (status_page_url, read-only)
  /keys* /activity* /providers
  /models/user /presets/**  (* = mgmt key)
```

- **Polling cadence:** credits every 60 s while app foreground / 15 min in
  background; usage delta pull on open + every 15 min; provider snapshot daily.
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

### 8.2 Usage Log
- Filterable, paginated list (model · provider · app · date range): cost, tokens,
  latency, state per row.
- Detail view: full metadata + deep-link to dashboard generation.
- Rollups tab: by day / by model / by provider / by app (local aggregation).

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
| `generations` | gen_id PK, created_at, model, provider, app_id, tokens_p*, tokens_c*, reasoning*, cached*, total_cost, upstream_cost, latency_ms, state |
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
3. Usage log browses ≥ last 7 days with correct rollups; offline shows stale.
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

## 13. Open questions for Spike 0 (before coding)

1. Exact behavior of `GET /generation` as a paginated list for a standard key
   (limits, cursor shape, `has_more`).
2. Whether `/generation/{id}/content` is readable with a standard key today.
3. Preset list/update semantics: fields editable via API, versioning behavior.
4. `/models/user` latency + shape for the policy reflection screen.
5. Android 14/secure-storage nuances for Expo (hardware-backed keystore vs
   encrypted app storage) — choose simple-first.