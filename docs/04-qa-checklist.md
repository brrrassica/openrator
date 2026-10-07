# OpenRator — v0.1 QA checklist (M5.4/M5.5)

Grounding: spec §11 acceptance criteria. Column key: 🟢 = verified in this run,
🟡 = needs a physical device / real account artifact, 🔴 = failed.

## 0. Pre-flight (repo state)

- [x] CI green on `main` (Gitea Actions: vitest 108, tsc, `expo export --platform android`)
- [x] Secrets guard passes (`tests/secrets-guard.test.ts` — no key in logs/db/URLs)
- [x] Engine E2E over real SQLite passes (`tests/integration-engine.test.ts`)
- [x] `node:sqlite`-caught blocker fixed: `limit` is a reserved word — schema + `upsertKeyRow` now quote it (this would have crashed first device launch)
- [x] EAS production build green — APK `0.1.0` (build `e6e1199a-c861-4d6f-b825-44d489276f47`, commit `805ac83`); SHA-256 `0048671c…` (§4)
- [x] EAS archive blocker fixed: root `.gitignore` had `apps/mobile/*.json`, which stripped `package.json`/`app.json`/`eas.json` from the build archive (`PRE_INSTALL_HOOK` → "package.json does not exist"); rule removed

## 1. Acceptance pass — spec §11

| # | Criterion | Status | How to verify | Notes |
|---|---|---|---|---|
| 1 | Fresh install → enter key → Home populated < 10 s (warm < 2 s) | 🟢 code-ready / 🟡 device | stopwatch on Android 12 + 16 | cold path = onboarding + `refreshAll`; warm = cached rollups render before refresh lands |
| 2 | Spend trend + top models/providers match dashboard (≤5 % variance) | 🟡 device (mgmt key) | compare Spend tab vs dashboard 30 d | tokenization/rounding differences → document; see §3 |
| 3 | Spend & endpoint analytics match dashboard 30-day activity (mgmt key); fallback + explainer without; offline stale | 🟡 device | tap Spend with mgmt key, then with standard key; airplane mode | fallback view + stale badge shipped (M3.4) |
| 4 | Provider toggle on a preset changes `provider.ignore` on OpenRouter and reads back; UI rollback on failure | 🟡 device | Policy tab → toggle a provider → reopen tab + open dashboard | write path unit-tested vs golden fixture (M4); live read-back needs device |
| 5 | Key edit/revoke works, reflects on dashboard immediately | 🟡 device (mgmt key) | Keys tab → rename/limit → check openrouter.ai/settings/keys | PATCH/DELETE shapes per docs; 401 verified on standard key only — mgmt pass pending |
| 6 | No credential leaves device except TLS to `openrouter.ai` | 🟢 guard + code review | network whitelist scan + code audit | secrets guard in CI; raw key only in secure store + memory |
| 7 | Builds via Expo, installs on Android 12+ without crash | 🟢 APK built / 🟡 sideload | EAS build → APK → sideload | production APK built 2026-10-07 (§4); install/soak still device-gated |

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

## 4. Release (M5.6)

1. [x] `cd apps/mobile && eas build -p android --profile production` — **built 2026-10-07**
   - Build: `e6e1199a-c861-4d6f-b825-44d489276f47` (profile `production`, channel `production`, internal distribution, APK)
   - Commit: `805ac83` · version `0.1.0` (versionCode 1) · SDK 57 · fingerprint `a0a88d92…`
   - APK: https://expo.dev/artifacts/eas/kDDUS4vG-GEgcIWDhhmyoeA0vkc8WAwAbrrrkeHmR3U.apk
   - SHA-256: `0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b` (86.5 MB)
2. [ ] Sideload the APK on both matrix devices (§2)
3. [ ] 72 h crash-free soak; record in §2
4. [ ] Tag `v0.1.0` on Gitea + push (tag runs CI once more)
5. [ ] Optional: `api_key_hash`-scoped `/activity` capture → pin v0.1 types (M0.5A)

Blockers: physical-device access (sideload + soak) lives outside this environment.