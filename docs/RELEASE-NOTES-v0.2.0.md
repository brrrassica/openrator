# OpenRator v0.2.0 — release notes (source-only)

![OpenRator horizontal lockup](assets/lockup-horizontal.png)

**Status:** source-only tag (`v0.2.0`). No APK is attached yet.
**Version:** `0.2.0` · **versionCode:** `3`.
**Scope:** release-quality gates for the device pass; Android only, private APK.

## Why a source-only release

The milestone work in this release is **device-independent QA and release
infrastructure**. Tagging it now makes the gates reproducible and reviewable
before an APK exists. The device pass remains the only blocking work:
sideload, 72 h crash-free soak, dashboard read-back with a management key.

## What changed

### Acceptance gate (M5.5)
- §11 criterion 7 now reads the real `package.json`, `app.json`, `eas.json`,
  CHANGELOG, and [`release.json`](release.json) instead of asserting
  `ok: true`. A version/versionCode/tag/profile/CHANGELOG/APK mismatch turns the
  row 🔴.
- Negative tests cover each mismatch, so the gate is proven to fail closed.

### Release-readiness gate (M5.6)
- `npm run release:check` (GitHub and Gitea CI) validates version,
  versionCode, tag, EAS production profile, CHANGELOG section, APK identity
  (for `status: "artifact"`), and duplicate JSON keys.
- `status: "source"` is a first-class state: it passes only when no APK identity
  is fabricated, and must be flipped to `"artifact"` with real build id, commit,
  SHA-256, and URL once the APK exists.
- Found and fixed duplicate `splash` and `android.package` keys in
  `app.json`; the duplicate package id had silently overridden
  `ai.openrator.app`.

### Device-run pipeline (M5.4)
- `npm run evidence:init` consumes a typed run record (see
  [`device-run.example.json`](device-run.example.json)), enforces two distinct
  devices, cold < 10 s / warm < 2 s / selector < 100 ms, a ≥ 72 h crash-free
  soak, per-criterion evidence, and release identity, then renders
  `04-device-evidence-<date>.md`.
- Example records are rejected, so a template cannot become fake evidence.
- Strict evidence validation now also rejects placeholder run metadata and an
  unconfirmed acceptance-report row.

## Verification

- 222 vitest tests (27 new), `tsc --noEmit` clean.
- `npm run acceptance:check`, `npm run acceptance:evidence`,
  `npm run release:check` all green.
- Android bundle export remains part of CI (`expo export --platform android`).

## Next steps

1. Build the v0.2.0 APK (EAS `production` profile).
2. Set `status: "artifact"` and record build id/commit/SHA-256/URL in
   [`release.json`](release.json); run `npm run release:check`.
3. Run the two-device pass via `npm run evidence:init`; complete the 72 h soak.
4. Tag remains `v0.2.0`; attach the signed APK to the release when ready.
