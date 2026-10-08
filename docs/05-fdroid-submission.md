# F-Droid submission — OpenRator

Status: **in preparation** (2026-10-08). Target: official F-Droid repo
(f-droid.org), app id `tech.alatcerdas.openrator`.

## Why this is possible

- Source is public on GitHub: https://github.com/brrrassica/openrator
- All dependencies are FOSS (Expo SDK 57 / RN 0.86 + expo modules; no
  Firebase/GMS/trackers/ads)
- License: MIT (added 2026-10-08)

## What was prepared (commit "F-Droid prep")

- `LICENSE` (root) + `apps/mobile/LICENSE` — MIT, © Sam Ralial.
  Original Expo-template license preserved as `apps/mobile/LICENSE.expo-template`.
- App id changed `ai.openrator.app` -> `tech.alatcerdas.openrator`
  (`apps/mobile/app.json`).
- `package.json` / `package-lock.json` license field `0BSD` -> `MIT`
  (dependency with a legit 0BSD license untouched).
- Upstream store metadata (Fastlane/Triple-T layout, repo root):
  `fastlane/metadata/android/en-US/`
  - `short_description.txt`, `full_description.txt`
  - `changelogs/1.txt` (v0.1.0), `changelogs/2.txt` (v0.1.1)
  - `images/icon.png` (512x512)
  - `images/phoneScreenshots/` — **TODO: add device screenshots**
- Draft for fdroiddata: `docs/fdroiddata-tech.alatcerdas.openrator.yml`

## Why the first F-Droid build is v0.1.1 (versionCode 2)

The v0.1.0 APK was built with the **old** app id `ai.openrator.app`. F-Droid
builds from source and publishes under `tech.alatcerdas.openrator`, so the
first buildable release must be a new tag. Once this prep commit is merged:

1. Bump `apps/mobile/app.json`: `"version": "0.1.1"`, `"versionCode": 2`
2. Commit + tag `v0.1.1`
3. Put the tag's commit hash into the `Builds.commit` FIXME in
   `docs/fdroiddata-tech.alatcerdas.openrator.yml`
4. Keep `versionCode` strictly increasing for every future release

## To submit (the actual MR)

1. Create an account on https://gitlab.com if you don't have one.
2. Fork https://gitlab.com/fdroid/fdroiddata (it's OK that it's huge —
   you only touch the `metadata/` folder).
3. Add `metadata/tech.alatcerdas.openrator.yml` using
   `docs/fdroiddata-tech.alatcerdas.openrator.yml`.
4. (Recommended) Install `fdroidserver` and run
   `fdroid build --test --server tech.alatcerdas.openrator` to smoke-test the
   recipe before maintainers run it. Expect iteration on the Expo build
   (JDK/gradle/prebuild flags).
5. Open the merge request; mention it's an Expo (SDK 57) managed app,
   `android/` is generated via `expo prebuild`.

## Review expectations

- Review + build pipeline takes **weeks to months** — normal.
- Expect questions about the "OpenRator"/OpenRouter naming (independent tool,
  BYOK, no affiliation — the store description states this).
- App must stay maintained; updates flow automatically once `AutoUpdateMode:
  Version` + tags are in place (tag a release, F-Droid does the rest).

## Local custom-repo alternative (if you want F-Droid-side testing sooner)

Not required for the official submission, but useful for soak testing the
F-Droid client against a signed repo before a public release:

```
apt install fdroidserver
mkdir fdroid && cd fdroid && fdroid init
mkdir repo && cp <built.apk> repo/
fdroid update --create-metadata
# serve the fdroid/ dir over HTTPS, then add https://<host>/fdroid/repo/ in the
# F-Droid client (Manage repos)
```
