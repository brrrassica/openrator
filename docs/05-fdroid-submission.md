# F-Droid Submission Guide — OpenRator

## Decision: Self-signed reproducible builds (developer-signed, exclusive mode)

Per the [F-Droid Reproducible Builds docs](https://f-droid.org/docs/Reproducible_Builds/),
we use **exclusive developer-signed** mode: fdroiddata metadata carries
`Binaries:` + `AllowedAPKSigningKeys:`, and F-Droid never signs with its own key.

### How it works

1. F-Droid rebuilds the recipe from source.
2. If the rebuild is byte-identical to our published APK (except for the signature),
   F-Droid copies our signature onto the rebuild and publishes **our** APK.
3. If the rebuild diverges (toolchain drift, non-determinism), that version is
   **skipped** — it is never published with F-Droid's key.

This means: **our signature is the only one that ever appears in the repo**.
Users never get an F-Droid-signed APK; they get ours, or nothing (for that version).

### Metadata fields (uncommented once the first signed release exists)

```yaml
Binaries:
  - https://github.com/brrrassica/openrator/releases/download/v%v/app-release.apk
AllowedAPKSigningKeys:
  - b3ccb3f651aee39b5a21ff8ac919ec21d26d28e3bc17e6de892e541f0a067692
```

- `Binaries:` URL uses `%v` (versionName) substitution — matches GitHub Release tag format.
- `AllowedAPKSigningKeys:` is the lowercase SHA-256 fingerprint of the v2+ signing cert.
  Get it with: `apksigner verify --print-certs app-release.apk | grep SHA-256`
- Both fields are enforced by `fdroid update` (fdroidserver `update.py:2782`).

### Keystore

- Generated 2026-10-25 on opencode-sam: RSA-4096, alias `openrator`.
- **Never commit the keystore or passwords to git.**
- Store the keystore in an encrypted backup and the password in a password manager.
- The keystore fingerprint is: `b3ccb3f651aee39b5a21ff8ac919ec21d26d28e3bc17e6de892e541f0a067692`

### Per-release flow

1. Tag the release: `git tag v0.1.1`
2. GitHub Actions (pinned toolchain: Node from `package.json` engines/.nvmrc,
   JDK 21, Android build-tools 36, `npm ci` lockfile) builds the unsigned APK.
3. Sign with `apksigner` (keystore/password as GitHub Actions secrets).
4. Attach the signed APK to the GitHub Release — `Binaries:` URL resolves.
5. Open the fdroiddata MR.

### Reproducibility proof

Before merging the MR, verify that the recipe rebuild is byte-identical:

```bash
# Build twice from clean state
rm -rf android/build app/build
npm ci
npx expo prebuild --platform android --clean --no-install
cd android && ./gradlew assembleRelease
sha256sum android/app/build/outputs/apk/release/app-release-unsigned.apk

# Compare with the second build — they must match exactly.
# If they don't, investigate with diffoscope.
```

On this box, the Gradle build crashes with SIGABRT during settings.gradle
evaluation (node `--print require.resolve(...)` crashes). This is an
environment-specific issue; the build works in F-Droid's CI environment
(validated 2026-10-08 with fdroidserver 2.4.2).

### Consequence of drift

If our published APK ever diverges from the fdroiddata rebuild, that version
is skipped (no update ships). Mitigation: locked toolchain + CI reproduction
per release.

---

## MR description

The paste-ready MR description is in `docs/fdroid-mr-description.md`.
Title must be exactly `New app: OpenRator`.

---

## Logo and splash screen

Custom logo assets were generated (commit `04be5fc`):

| Asset | Size | Description |
|---|---|---|
| `icon.png` | 1024×1024 | OR monogram on dark blue-gray background |
| `android-icon-foreground.png` | 512×512 | Matching design, transparent bg |
| `android-icon-background.png` | 512×512 | Light blue (#E6F4FE) solid bg |
| `android-icon-monochrome.png` | 432×432 | Monochrome variant |
| `favicon.png` | 48×48 | Web favicon |
| `splash-icon.png` | 1024×1024 | Splash screen with logo |

No framework default assets (Expo robot, etc.) are used anywhere.
Splash screen is configured in `apps/mobile/app.json`.