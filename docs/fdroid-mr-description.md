# fdroiddata MR: OpenRator — paste-ready description

MR title (required format): **New app: OpenRator**

Metadata file added: `metadata/tech.alatcerdas.openrator.yml` — content is the YAML
block in [`docs/fdroiddata-tech.alatcerdas.openrator.yml`](fdroiddata-tech.alatcerdas.openrator.yml)
(extract between the ```yaml fences). Nothing else is added to this MR; all store
content (summary, description, icon, changelogs) lives in the upstream repo's
Fastlane folder.

---

## Abstract

### Please introduce the functions and usage of your app in summary, and also attach some screenshots.

**OpenRator** is a single-pane dashboard for your OpenRouter account (an LLM/API
gateway), built for Android with Expo / React Native. Bring your own key — the app
keeps it only in the Android keystore and talks to OpenRouter directly: no backend,
no accounts, no ads, no trackers, no analytics SDK.

- **Home**: credits/balance at a glance, 14-day spend trend, provider health strip, pull-to-refresh
- **Spend & Endpoint analytics**: 30-day usage chart plus provider and endpoint breakdowns
- **Provider Policy editor**: provider catalog with routing presets (optimistic writes)
- **Keys**: management-key CRUD, create/reveal flows, clear-on-sign-out

Screenshots: pending — they require a physical-device capture; the upstream
`fastlane/metadata/android/en-US/images/phoneScreenshots/` folder is stubbed and
will be filled before/right after merge (the rest of the upstream metadata —
summary, description, 512 px icon, changelogs — is already in the repo).

### Please elaborate why you wrote this app. Please highlight the unique functions it provides over other similar apps in F-Droid.

OpenRouter's web dashboard is not usable as a phone app, and existing mobile
options are web wrappers or require their own accounts/backends. I wanted a
native, fully on-device client: keys never leave the keystore, usage and spend
analytics (which OpenRouter only surfaces per-key on the web UI), provider
routing presets, and management-key support. To my knowledge this is the only
native Android OpenRouter client in F-Droid.

## Checklist

### Policy

- [x] The app complies with the [inclusion criteria](https://f-droid.org/docs/Inclusion_Policy).
      MIT-licensed, no non-free components, built entirely from source.
- [x] The original app author has been notified (and does not oppose the inclusion).
      I am the author (Sam Ralial, sam@alatcerdas.tech).
- [x] The upstream app source code repo contains the app metadata in a
      [Fastlane](https://gitlab.com/snippets/1895688) folder structure
      (`fastlane/` at repo root). Summary and description included; icon (512 px),
      changelogs and triple-t were added; `en-US` locale present. Screenshots are
      stubbed and will be filled in from a physical device.

### Docs

- [x] Read [the guide](https://gitlab.com/fdroid/fdroiddata/-/blob/master/CONTRIBUTING.md).
- [x] Metadata follows the templates (modeled on `templates/build-react-native.yml`).
- [x] Read the [Build Metadata Reference](https://f-droid.org/docs/Build_Metadata_Reference/).
- [x] Read the [Quick Start Guide](https://f-droid.org/en/docs/Submitting_to_F-Droid_Quick_Start_Guide/).

### Merge Request Setup

- [x] The title of this merge request follows "New app: OpenRator" format.
- [x] fdroiddata fork is public and branch is not protected.
- [x] Read the Git guide; will not rebase unless a conflict appears.
- [x] All related fdroiddata/RFP issues referenced: none — searched, no existing
      RFP/fdroiddata issue for this app.
- [x] Only one app in this MR.

### Metadata

- [x] Metadata is in `metadata/tech.alatcerdas.openrator.yml`.
- [x] Valid YAML, LF line endings.
- [x] No unrelated files added — please check the Changes tab (only the metadata
      file; summary/description/icon/changelogs come from upstream).

- [x] Releases are tagged and auto update is enabled: tag `v0.1.1`,
      `UpdateCheckMode: Tags`, `AutoUpdateMode: Version`.
- [x] Issue tracker and author contact provided (GitHub issues +
      AuthorEmail/AuthorWebSite).
- [x] AuthorName added: Sam Ralial.
- [x] No external repos — all deps are npm packages fetched by the build
      (no srclibs, no git submodules).
- [ ] Reproducible Builds — **not enabled yet**, reason: the recipe is pinned by
      `package-lock.json` and the RN/Expo gradle toolchains, but the author-side
      release pipeline (key handling, EAS artifact publication) is not set up.
      Happy to enable before merge if a maintainer prefers — otherwise I
      understand the APK will be signed with F-Droid's key and this cannot be
      switched later; please advise.
- [ ] ABI split — not yet: the release APK is ~86 MB (4 ABIs). I'd rather ship
      the first release unsplit; can add splits in the next version if
      maintainers recommend it.
- [x] Only the latest version kept in metadata.
- [x] No disabled versions.
- [x] The `commit` field is the full hash:
      `46beea97834d622256d72af40b4b995fc0229263` (points at tag `v0.1.1`).

### Pipeline

- [ ] All pipelines should pass — CI will be triggered by opening this MR
      (runners are GitLab FOSS; nothing further needed from me).
- [ ] All warnings/errors in the Reports tab will be fixed or explained.
- [x] Understood that CI runs on GitLab's FOSS program; will not pay for CI.

## Notes for maintainers

- **Recipe already validated**: built end-to-end with `fdroid build --test`
  (fdroidserver 2.4.2, JDK 21, current Node) — 3/3 green. The pipeline
  clone → `npm ci` → `npx expo prebuild --platform android --clean --no-install`
  → `./gradlew assembleRelease` completes and the APK checks pass (app id
  `tech.alatcerdas.openrator`, versionName `0.1.1`, versionCode `2`). Details in
  `MaintainerNotes`.
- **AntiFeatures: NonFreeNet is intentional** — the app depends entirely on the
  proprietary OpenRouter API (BYOK). If the reviewer considers that inapplicable
  or you'd prefer it added differently, tell me and I'll adjust.
- **versionCode 2 is the first F-Droid build on purpose**: v0.1.0 was
  sideloaded via EAS under the old application id `ai.openrator.app`, so it is
  not reusable; 0.1.1 is the first release carrying `tech.alatcerdas.openrator`.
- **Expo managed workflow**: `android/` is generated by `expo prebuild` and is
  NOT committed (gitignored), so every build runs prebuild first —
  `MaintainerNotes` explains the recipe.