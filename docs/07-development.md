# OpenRator — development guide

Development-facing information lives here so the top-level
[`README.md`](../README.md) stays focused on users.

## Repository layout

| Path | Purpose |
|---|---|
| [`apps/mobile/`](../apps/mobile/) | Expo / React Native Android app (TypeScript) |
| [`apps/mobile/src/`](../apps/mobile/src/) | App source: core client, providers, store, sync, UI, QA |
| [`apps/mobile/tests/`](../apps/mobile/tests/) | Vitest unit and acceptance suites |
| [`docs/`](.) | Specifications, plans, QA, brand, release records |
| [`brand/`](../brand/) | SVG brand masters, fonts, and generated previews |
| [`scripts/brand/`](../scripts/brand/) | Deterministic SVG → PNG asset pipeline |
| [`plans/`](../plans/) | Roadmaps and implementation plans |

## Local setup

```sh
cd apps/mobile
npm ci
npm start            # Expo dev server
npm test             # Vitest unit suite
npm run typecheck    # tsc --noEmit
npm run assets:build # regenerate brand PNGs from SVG masters
npm run assets:check # fail on asset drift (CI)
```

The app targets Android 12+ and uses Expo SDK 57. It is BYOK on-device: no API
key is needed for the test suite, and no secret belongs in the repository.

## Quality gates

CI runs the same checks on GitHub Actions and the self-hosted Gitea mirror:

1. Brand asset drift (`npm run assets:check`)
2. Unit suite (`npx vitest run`)
3. Acceptance-report drift (`npm run acceptance:check`)
4. Device-evidence validation (`npm run acceptance:evidence`)
5. Release readiness (`npm run release:check`)
6. Typecheck (`npx tsc --noEmit`)
7. Android bundle export (`npx expo export --platform android`)

See [`04-ci-notes.md`](04-ci-notes.md) for CI topology and operations.

## Building a release

1. Confirm the version in [`apps/mobile/package.json`](../apps/mobile/package.json)
   and [`apps/mobile/app.json`](../apps/mobile/app.json) match
   [`release.json`](release.json), then run `npm run release:check`.
2. Tag the source release: `git tag v<version>`.
3. Build the signed APK with the `production` profile:

   ```sh
   cd apps/mobile
   eas build -p android --profile production
   ```

4. After the build finishes, set `status: "artifact"` in
   [`release.json`](release.json) and record the build id, commit, SHA-256, APK
   URL, and byte count.
5. Attach the APK to the GitHub release and update the matching
   `RELEASE-NOTES-v<version>.md`.
6. Run the device pass and soak described in
   [`04-qa-checklist.md`](04-qa-checklist.md); render evidence with
   `npm run evidence:init`.

F-Droid packaging notes are in [`05-fdroid-submission.md`](05-fdroid-submission.md).

## Documentation index

### Product and architecture

- [`01-specification.md`](01-specification.md) — product spec, verified API
  surface, architecture, decisions
- [`02-roadmap-v0.1.md`](02-roadmap-v0.1.md) — v0.1 roadmap and exit criteria
- [`03-spike-notes.md`](03-spike-notes.md) — live API spike results
- [`05-provider-integrations.md`](05-provider-integrations.md) — provider
  transports, units, capability matrix, manual fallback rules
- [`plans/03-roadmap.md`](../plans/03-roadmap.md) — current roadmap
- [`plans/v0.2.0-plan.md`](../plans/v0.2.0-plan.md) — v0.2.0 delivery plan

### Quality and release

- [`04-qa-checklist.md`](04-qa-checklist.md) — acceptance criteria and device
  matrix
- [`04-qa-acceptance.md`](04-qa-acceptance.md) — acceptance report
- [`04-device-evidence-template.md`](04-device-evidence-template.md) — device
  evidence template
- [`04-ci-notes.md`](04-ci-notes.md) — CI setup and operations
- [`05-fdroid-submission.md`](05-fdroid-submission.md) — F-Droid packaging
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`release.json`](release.json) — current release identity

### Brand

- [`06-brand-guide.md`](06-brand-guide.md) — mark, palette, typography, icon
  grid, asset pipeline
- [`assets/README.md`](assets/README.md) — generated brand asset index

### Release notes

- [`RELEASE-NOTES-v0.2.1.md`](RELEASE-NOTES-v0.2.1.md)
- [`RELEASE-NOTES-v0.2.0.md`](RELEASE-NOTES-v0.2.0.md)
- [`RELEASE-NOTES-v0.1.1.md`](RELEASE-NOTES-v0.1.1.md)
- [`RELEASE-NOTES-v0.1.0.md`](RELEASE-NOTES-v0.1.0.md)
