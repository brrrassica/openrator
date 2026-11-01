# OpenRator v0.2.0 — release notes

![OpenRator horizontal lockup](assets/lockup-horizontal.png)

**Status:** released 2026-11-01 — signed APK attached (`openrator-0.2.0.apk`).
**Version:** `0.2.0` · **versionCode:** `3` · **package:** `tech.alatcerdas.openrator`.
**Scope:** Android only, private APK (BYOK, no accounts, no analytics SDK).

## Release artifact

- `openrator-0.2.0.apk` — EAS build `ec4f08f0-1861-4980-b531-d58399b92f9d`,
  commit `81054c3`, built from tag `v0.2.0` on the `production` profile.
- Size: 86,517,454 bytes · SHA-256:
  `07eb8e9c5d7e9d1aa617186f1f48212bdb896fa7b9e8b292dec5c8bc0064f1b1`.
- Signing certificate SHA-256:
  `389f40887d99b5947ae467e6120554d2c54afc12103123559bbb26f8c30ae79f`
  (shared with the v0.1.1 APK).

The milestone work in this release is **device-independent QA and release
infrastructure**, plus the fixes needed to produce a real APK. The device pass
remains the only blocking work: sideload, 72 h crash-free soak, and dashboard
read-back with a management key.

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

1. Run the two-device pass via `npm run evidence:init`; complete the 72 h soak.
2. Publish the F-Droid merge request using the updated signing fingerprint in
   [`fdroiddata-tech.alatcerdas.openrator.yml`](fdroiddata-tech.alatcerdas.openrator.yml).
3. Attach the rendered device evidence to the release record.
