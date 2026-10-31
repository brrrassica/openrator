# OpenRator — v0.1 QA checklist (M5.4/M5.5)

<img src="assets/lockup-stacked.png" alt="OpenRator stacked lockup" width="220" />

Grounding: spec §11 acceptance criteria. Column key: 🟢 = verified in this run,
🟡 = needs a physical device / real account artifact, 🔴 = failed.

## 0. Pre-flight (repo state)

- [x] CI green on `main` (Gitea Actions: vitest 222, tsc, `expo export --platform android`)
- [x] Secrets guard passes (`tests/secrets-guard.test.ts` — no key in logs/db/URLs)
- [x] Engine E2E over real SQLite passes (`tests/integration-engine.test.ts`)
- [x] Scenario matrix over real SQLite (mgmt vs standard persona, offline cache retention/restart, pagination + cyclic cursors, policy write/read-back + failed-write truth, key CRUD, 402/429 failure isolation, malformed 2xx envelopes, rollup pruning) — `tests/scenario-matrix.test.ts`, 13 tests
- [x] Automated §11 acceptance harness — `npm run acceptance` asserts every device-independent check and regenerates [`04-qa-acceptance.md`](04-qa-acceptance.md) **and** machine-readable [`04-qa-acceptance.json`](04-qa-acceptance.json), 21 tests. Criterion 7 is a **real** manifest gate (package/app/eas versions, versionCode, tag, CHANGELOG, build id, commit, SHA-256) with negative tests proving it fails closed — no more hardcoded `ok: true`.
- [x] Acceptance report drift gate in CI — `npm run acceptance:check` fails if either committed report (markdown or JSON) differs from a fresh deterministic run
- [x] Device-pass evidence template — [`04-device-evidence-template.md`](04-device-evidence-template.md) covers matrix, per-criterion evidence, M5.4 script, and M5.6 sign-off
- [x] Device-evidence validator — `tests/device-evidence.test.ts` + `npm run acceptance:evidence` in CI; validates the template structure and fails any completed `docs/04-device-evidence-*.md` that still has `____` device cells or unchecked sign-off boxes
- [x] Accessibility gate (M5.3/M5.4) — `tests/a11y-audit.test.ts` enforces WCAG-AA (≥ 4.5:1) contrast for every light/dark token pair and statically requires ≥ 44 px `minHeight` or `hitSlop` on every `Pressable`/`Touchable*`
- [x] Start-budget harness (M5.4) — `tests/start-budget.test.ts` pins cold < 10 s, warm < 2 s, selector < 100 ms and rejects negative/non-finite device measurements
- [x] `node:sqlite`-caught blocker fixed: `limit` is a reserved word — schema + `upsertKeyRow` now quote it (this would have crashed first device launch)
- [x] EAS production build green — APK `0.1.0` (build `e6e1199a-c861-4d6f-b825-44d489276f47`, commit `805ac83`); SHA-256 `0048671c…` (§4)
- [x] EAS archive blocker fixed: root `.gitignore` had `apps/mobile/*.json`, which stripped `package.json`/`app.json`/`eas.json` from the build archive (`PRE_INSTALL_HOOK` → "package.json does not exist"); rule removed
- [x] Release-readiness gate (M5.6) — `npm run release:check` validates `package.json` / `app.json` / `eas.json` / [`release.json`](release.json) / CHANGELOG agreement (version, versionCode, tag, APK build id, commit, SHA-256, HTTPS URL) and rejects duplicate JSON keys; wired into both CI backends. Found and fixed two duplicate keys in `app.json` (`splash`, `android.package` — the latter silently changed the effective package id).
- [x] Device-run evidence pipeline (M5.4) — [`device-run.example.json`](device-run.example.json) documents the typed input; `npm run evidence:init` validates two devices, the cold/warm/selector budgets, a ≥ 72 h crash-free soak, per-criterion evidence, and release identity, then renders `04-device-evidence-<date>.md`. `example: true` records are rejected, so a template can never become fake evidence.

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

### 1a. Automated acceptance report (M5.5)

Run `cd apps/mobile && npm run acceptance`. It executes the device-independent
§11 checks and regenerates both [`04-qa-acceptance.md`](04-qa-acceptance.md)
(human-readable) and [`04-qa-acceptance.json`](04-qa-acceptance.json)
(machine-readable summary) — currently 1 🟢 criterion + 6 🟡 device-gated
criteria, **all automated portions pass**. CI runs `npm run acceptance:check`,
which fails on any drift in either committed report, then
`npm run acceptance:evidence`, which validates the evidence template and any
completed copy. Use the report during the device pass; fill
[`04-device-evidence-template.md`](04-device-evidence-template.md) for the 🟡
rows (a dated copy must have no `____` cells and all sign-off boxes checked).
A 🔴 row is a regression, while a 🟡 row only means the device/account artifact
is pending.

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

0. [x] `cd apps/mobile && npm run release:check` — manifest/tag/APK identity gate (reads [`release.json`](release.json))
1. [x] `cd apps/mobile && eas build -p android --profile production` — **built 2026-10-07**
   - Build: `e6e1199a-c861-4d6f-b825-44d489276f47` (profile `production`, channel `production`, internal distribution, APK)
   - Commit: `805ac83` · version `0.1.0` (versionCode 1) · SDK 57 · fingerprint `a0a88d92…`
   - APK: https://expo.dev/artifacts/eas/kDDUS4vG-GEgcIWDhhmyoeA0vkc8WAwAbrrrkeHmR3U.apk
   - SHA-256: `0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b` (86.5 MB)
   - Machine-readable identity: [`release.json`](release.json) (version/versionCode/buildId/commit/sha256/tag/bytes)
2. [ ] Sideload the APK on both matrix devices (§2)
3. [ ] 72 h crash-free soak; record in §2
4. [x] Tag `v0.2.0` on GitHub + push (source-only release: `docs/release.json` `status: "source"`; tag runs CI once more)
5. [ ] Optional: `api_key_hash`-scoped `/activity` capture → pin v0.1 types (M0.5A)

> **v0.2.0 is a source-only tag.** The release gate validates manifests,
> versionCode 3, the tag, and the CHANGELOG, but there is no v0.2.0 APK yet.
> Build it, set `status: "artifact"` plus the build id/commit/SHA-256 in
> [`release.json`](release.json), then run the device pass and `release:check`.

Blockers: physical-device access (sideload + soak) lives outside this environment.