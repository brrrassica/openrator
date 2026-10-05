# OpenRator — Spike Notes (M0)

**Date:** 2026-10-05 · **Method:** live calls to `https://openrouter.ai/api/v1`
with a standard (non-management) OpenRouter API key from the homelab env.
No secrets are stored in this file. All payloads examined but not committed.

---

## 0. Key used

- Type: standard API key (`is_management_key: false`), daily limit, free-tier:
  `false`, `free_model_daily_requests: {limit: 1000}`.
- Consequence: endpoints that require a management key were tested and their
  401/403 behavior recorded; they are NOT reachable for a default user.

## 1. Verified endpoint matrix (standard key)

| Endpoint | Result | Notes |
|---|---|---|
| `GET /key` | **200** | Full payload incl. `usage*, limit, limit_remaining, limit_reset, expires_at, label, byok_usage*, free_model_daily_requests, allowed_data_regions, is_management_key, workspace_id, organization_id`. `rate_limit` deprecated (always -1). |
| `GET /credits` | **200** | `{total_credits, total_usage}`. **Docs say management-key-only — worked with a standard key.** Mark: works today, treat gracefully if policy changes (show lock state on 403). |
| `GET /generation` (no id) | **400** | `{"error":{"message":"id: Invalid input: expected string, received undefined","code":400}}`. **No public list endpoint.** `/generations`, `/usage`, `/key/generations` → 404. |
| `GET /generation?id=` | not tested | Requires an id you can only obtain from your own responses; no enumeration possible. |
| `GET /activity` | **403** | `Only management keys can fetch activity for an account`. (30-day endpoint analytics.) |
| `GET /keys` | **401** | Management-key-only (key list + CRUD). |
| `GET /providers` | **200** | 112 providers. Fields: `name, slug, privacy_policy_url, terms_of_service_url, status_page_url, headquarters, datacenters[]`. 73/112 have `status_page_url: null`. |
| `GET /models/user` | **200** | `{data: 282 models, total_count, links}`. Record fields: `id, canonical_slug, hugging_face_id, name, created, description, context_length, architecture, pricing, top_provider, per_request_limits, supported_parameters, default_parameters, supported_voices, knowledge_cutoff, expiration_date, links, reasoning`. Filtered by user provider prefs/privacy/guardrails — read-only reflection. **No per-endpoint provider list in the payload** (that's `/models/{author}/{slug}/endpoints`). |
| `GET /presets` | **200** | `{data: [], total_count: 0}` for this key — list works with a standard key. |
| `POST /presets` | **404** | Presets are NOT created via plain `POST /presets`. |

## 2. Presets — the control plane (verified workflows)

Endpoint: `POST /presets/{slug}/chat/completions` — "create or update a preset
from an inference request body". Config fields (overlapping set: `model`,
`temperature`, `provider`, `top_p`, `system` …) are persisted; `messages`,
`stream`, `prompt` are ignored → **call is free, no inference is charged**
(credits unchanged before/after in test).

Verified:
- Create: `{"model":"openai/gpt-4o-mini","temperature":0.7,"provider":{"ignore":["moonshotai"]}}`
  → 200, preset created, `designated_version.config.provider.ignore` persisted.
- Update: same POST again with `provider.ignore:["moonshotai","google"]`
  → 200, **new version** (`version: 2`), old version retained.
- List/detail: `GET /presets/{slug}` → `{id, slug, name, status, designated_version_id, designated_version{version, config, system_prompt}, timestamps}`.
- Version history: `GET /presets/{slug}/versions` and `/versions/{n}` → **200**.
- Delete: `DELETE /presets/{slug}` → **404**. Variants (`/versions`,
  `/delete`, `DELETE /preset/{slug}`, `PATCH /presets/{slug}`) all 404.
  **Deletion is dashboard-only** — OpenRator must not offer delete; user
  clean-up via dashboard.

## 3. Error taxonomy (verified + documented)

| Status | Verified trigger | UI mapping |
|---|---|---|
| 400 | missing/`undefined` required param (e.g. generation `id`) | dev-log only; shouldn't surface in app |
| 401 | `Invalid API key` (/keys with standard key) | "bad key" state → re-enter key |
| 402 | documented (limits.md): `error.metadata.limit_source` ∈ `openrouter_key_limit` \| `openrouter_credits` \| `openrouter_in_flight_budget` + `remedy_hint`; `Retry-After` header | credits-empty card + remedy hint + deep-link |
| 403 | management-key-only endpoint with standard key | "management key required" lock state |
| 404 | unknown path / delete unsupported | hide unsupported actions |
| 429 | documented: platform or upstream rate limit; `X-RateLimit-*` headers; backoff | stale badge + backoff messaging |
| 5xx | — | retry + stale badge |

## 4. Design consequences for v0.1

1. **Home Pane (credits widget):** fully buildable from `GET /key`
   (+ `GET /credits` while it works for standard keys). No change.
2. **Usage Log (spec change pending):** per-request generation history is **not
   reachable** via public API with a standard key. Options:
   - **Recommended:** v0.1 shows **Spend & Endpoint analytics** from
     `GET /activity` (requires a management key — add "enable management key"
     onboarding path) + `GET /key` usage windows. No per-request list.
   - Fallback for no-mgmt-key users: credits buckets + local cost snapshots.
   - (Per-request logs would need a client that records its own generation ids,
     or an undocumented/scoped API — out of scope.)
3. **Provider Policy:** buildable exactly as spec'd — catalog
   (`GET /providers`), effective-prefs reflection (`GET /models/user`,
   `top_provider` shown per model), and policy editing via **Preset
   create/update/version** (cost-free). No delete offered (dashboard-only).
4. **Keys:** standard key → current-key card only. List/CRUD gated behind a
   management key (401 otherwise) → onboarding must explain the two key types.
   PATCH body verified from docs: `label, limit, limit_reset, include_byok_in_limit, expires_at`.
5. **models/user size:** 282 records ≈ heavy for a phone in one shot → cache
   with `links.next` pagination (offset-based per `links`), refresh daily.

## 5. M0.8 — Secure storage decision (decided)

- **expo-secure-store** for the API key(s) (hardware-backed keystore where
  available; falls back to encrypted storage).
- **expo-sqlite** for cache tables (usage rollups, provider snapshot,
  models/user cache). The API key **never** goes into SQLite.
- Install via `npx expo install expo-secure-store expo-sqlite`.

## 6. M0.2 — Device on-ramp note (homelab constraint)

This host has no Android emulator/device. Local M0.2 validation = production
bundle compiles (`npx expo export --platform android`). Physical smoke test
deferred to first EAS build (documented in roadmap M5.6).

## 7. Cleanup action needed (manual)

Test preset `openrator-spike-tmp` (2 versions) remains on the OpenRouter
account — deletion is dashboard-only. Delete at
https://openrouter.ai/settings/presets (keep until spec change confirmed, then
remove).