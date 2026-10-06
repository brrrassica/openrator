# OpenRator — v0.1 QA checklist (M5.4/M5.5)

Grounding: spec §11 acceptance criteria. Column key: 🟢 = verified in this run,
🟡 = needs a physical device / real account artifact, 🔴 = failed.

## 0. Pre-flight (repo state)

- [x] CI green on `main` (Gitea Actions: vitest 89, tsc, `expo export --platform android`)
- [x] Secrets guard passes (`tests/secrets-guard.test.ts` — no key in logs/db/URLs)
- [x] Engine E2E over real SQLite passes (`tests/integration-engine.test.ts`)
- [x] `node:sqlite`-caught blocker fixed: `limit` is a reserved word — schema + `upsertKeyRow` now quote it (this would have crashed first device launch)

## 1. Acceptance pass — spec §11

| # | Criterion | Status | How to verify | Notes |
|---|---|---|---|---|
| 1 | Fresh install → enter key → Home populated < 10 s (warm < 2 s) | 🟢 code-ready / 🟡 device | stopwatch on Android 12 + 16 | cold path = onboarding + `refreshAll`; warm = cached rollups render before refresh lands |
| 2 | Spend trend + top models/providers match dashboard (≤5 % variance) | 🟡 device (mgmt key) | compare Spend tab vs dashboard 30 d | tokenization/rounding differences → document; see §3 |
| 3 | Spend & endpoint analytics match dashboard 30-day activity (mgmt key); fallback + explainer without; offline stale | 🟡 device | tap Spend with mgmt key, then with standard key; airplane mode | fallback view + stale badge shipped (M3.4) |
| 4 | Provider toggle on a preset changes `provider.ignore` on OpenRouter and reads back; UI rollback on failure | 🟡 device | Policy tab → toggle a provider → reopen tab + open dashboard | write path unit-tested vs golden fixture (M4); live read-back needs device |
| 5 | Key edit/revoke works, reflects on dashboard immediately | 🟡 device (mgmt key) | Keys tab → rename/limit → check openrouter.ai/settings/keys | PATCH/DELETE shapes per docs; 401 verified on standard key only — mgmt pass pending |
| 6 | No credential leaves device except TLS to `openrouter.ai` | 🟢 guard + code review | network whitelist scan + code audit | secrets guard in CI; raw key only in secure store + memory |
| 7 | Builds via Expo, installs on Android 12+ without crash | 🟢 bundle / 🟡 sideload | EAS build → APK → sideload | `expo export` green every push; EAS needs credentials (§5) |

## 2. Device matrix (two devices minimum)

| Device | Android | Version | Cold start | Warm start | Soak 72 h | Notes |
|---|---|---|---|---|---|---|
| (dedicated test phone) | 12+ | 0.1.0 | __ s | __ s | __ / __ | |
| (secondary phone/tablet) | 14–16 | 0.1.0 | __ s | __ s | __ / __ | |

Steps per device: fresh install → onboarding (paste key, mgmt toggle) → Home populated →
Spend (mgmt + standard + airplane) → Providers catalog search/sort → Policy toggle one
provider → Keys CRUD (create → reveal → copy → test → collapse → revoke) →
clear stored key → restart → onboarding again.

## 3. Known-variance documentation (tokenization)

Δ between OpenRator Spend and dashboard figures is expected up to the stated tolerance;
record observed deltas here after the device pass: ____

## 4. Release (M5.6 — Sam-executed)

1. `cd apps/mobile && npx eas-cli@latest build -p production` (EAS login + project link required once)
2. Grab APK from EAS artifacts; sideload on both matrix devices
3. 72 h crash-free soak; record in §2
4. Tag `v0.1.0` on Gitea + push (tag runs CI once more)
5. Optional: `api_key_hash`-scoped `/activity` capture → pin v0.1 types (M0.5A)

Blockers: EAS account/device access live outside this environment.