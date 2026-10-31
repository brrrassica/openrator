# OpenRator asset index (v0.2)

Every raster in this directory and in `apps/mobile/assets` is generated from the
committed SVG masters in [`brand/svg`](../../brand/svg). Do not hand-edit the
PNGs; edit the master and run `npm run assets:build` from `apps/mobile`.

See [`docs/06-brand-guide.md`](../06-brand-guide.md) for palette, clear space,
typography, icon grid, and trademark rules.

---

## Marks

<img src="mark-512.png" alt="OpenRator mark, duotone" width="160" />
<img src="mark-monochrome-512.png" alt="OpenRator mark, monochrome" width="160" />

- `mark-512.png` — duotone mark on transparent
- `mark-monochrome-512.png` — monochrome mark on transparent

## Wordmark and lockups

<img src="wordmark.png" alt="OpenRator wordmark" width="640" />

<img src="lockup-horizontal.png" alt="OpenRator horizontal lockup" width="900" />

<img src="lockup-stacked.png" alt="OpenRator stacked lockup" width="420" />

- `wordmark.png` — wordmark only
- `lockup-horizontal.png` — mark + wordmark + tagline
- `lockup-stacked.png` — stacked mark + wordmark + tagline

## Social and release art

<img src="social-preview.png" alt="OpenRator social preview" width="720" />

<img src="release-banner.png" alt="OpenRator v0.2 release banner" width="720" />

- `social-preview.png` — 1200×630 link preview and README hero
- `release-banner.png` — 1600×900 release-note and announcement banner

## Source artwork

<img src="brand/source-mark.png" alt="Approved source mark crop" width="160" />
<img src="brand/source-mark-bw.png" alt="Thresholded source mark used for tracing" width="160" />

- `brand/source-mark.png` — crop of the approved artwork
- `brand/source-mark-bw.png` — thresholded reference used by potrace

## Mobile app assets

<img src="../../apps/mobile/assets/icon.png" alt="App icon" width="128" />
<img src="../../apps/mobile/assets/android-icon-foreground.png" alt="Adaptive icon foreground" width="128" />
<img src="../../apps/mobile/assets/android-icon-background.png" alt="Adaptive icon background" width="128" />
<img src="../../apps/mobile/assets/android-icon-monochrome.png" alt="Android 13 monochrome icon" width="128" />
<img src="../../apps/mobile/assets/splash-icon.png" alt="Splash mark" width="128" />
<img src="../../apps/mobile/assets/favicon.png" alt="Favicon" width="48" />
<img src="../../apps/mobile/assets/notification-icon.png" alt="Notification icon" width="48" />

| Asset | Path | Notes |
|---|---|---|
| App icon | `apps/mobile/assets/icon.png` | 1024×1024, full-bleed |
| Adaptive foreground | `apps/mobile/assets/android-icon-foreground.png` | 1024×1024, 66 dp safe zone |
| Adaptive background | `apps/mobile/assets/android-icon-background.png` | 1024×1024 gradient |
| Monochrome | `apps/mobile/assets/android-icon-monochrome.png` | 1024×1024, OS-tinted |
| Splash | `apps/mobile/assets/splash-icon.png` | 1024×1024, white mark |
| Favicon | `apps/mobile/assets/favicon.png` | 48×48 |
| Notification | `apps/mobile/assets/notification-icon.png` | 96×96, white on transparent |

## Regeneration and verification

```sh
node scripts/brand/make-masters.mjs   # masters from the approved trace
cd apps/mobile
npm run assets:build                  # write every PNG
npm run assets:check                  # fail on drift (CI gate)
```

- Trace source: [`brand/generated/mark-trace.svg`](../../brand/generated/mark-trace.svg)
- Approved source: [`brand/source/openrator.jpeg`](../../brand/source/openrator.jpeg)
- Font: [`brand/fonts/LiberationSans-Bold.ttf`](../../brand/fonts/LiberationSans-Bold.ttf) (SIL OFL 1.1)
