# OpenRator — Brand Guide (v0.2)

**Status:** v0.2.0 work-in-progress. Tagline and final palette accent are still
provisional (see §8).

---

## 1. Source of truth

The mark is the **approved eagle/chevron artwork** from
[`brand/source/openrator.jpeg`](../brand/source/openrator.jpeg), isolated and
traced into a vector master. The approved bitmap crop is
[`docs/assets/brand/source-mark-bw.png`](assets/brand/source-mark-bw.png).

```
brand/source/openrator.jpeg
        │  crop + threshold
        ▼
docs/assets/brand/source-mark-bw.png      (approved reference)
        │  potrace
        ▼
brand/generated/mark-trace.svg             (traced path)
        │  scripts/brand/make-masters.mjs
        ▼
brand/svg/*.svg                            (committed masters)
        │  scripts/brand/build-assets.mjs
        ▼
apps/mobile/assets/*.png + docs/assets/*.png
```

**Never hand-edit a raster asset.** Edit the SVG master (or the trace), then run:

```sh
node scripts/brand/make-masters.mjs   # regenerate SVG masters from the trace
cd apps/mobile
npm run assets:build                  # regenerate every PNG
npm run assets:check                  # CI drift gate
```

`npm run assets:check` fails when a committed PNG no longer matches its SVG
master. CI should run it on every push.

---

## 2. The mark

- **Meaning:** an eagle head facing right, formed by forward chevrons
  (OpenRouter routing) and a hooked beak (operator/curator).
- **Construction:** single path, `fill-rule="evenodd"`; the eye is a natural
  cutout, so the mark works on any background without a second color.
- **Formats:** solid, duotone, monochrome.
- **Clear space:** 0.25 × the mark height on every side.
- **Minimum size:** 24 px for digital use; 8 mm for print.
- **Do not:** rotate, outline, add shadows, recolor the eye independently, place
  it on a busy photo, or combine it with a third-party logo.
- **Monochrome:** always a single silhouette; Android themes the color.

### Lockups

| Lockup | File | Use |
|---|---|---|
| Horizontal | [`brand/svg/lockup-horizontal.svg`](../brand/svg/lockup-horizontal.svg) | README, social, docs headers |
| Stacked | [`brand/svg/lockup-stacked.svg`](../brand/svg/lockup-stacked.svg) | Splash, release art, square placements |
| Wordmark only | [`brand/svg/wordmark.svg`](../brand/svg/wordmark.svg) | Narrow spaces; never smaller than 96 px wide |
| Social preview | [`brand/svg/social-preview.svg`](../brand/svg/social-preview.svg) | Gitea/GitHub link preview, release banner |

---

## 3. Color

Tokens live in [`brand/tokens.json`](../brand/tokens.json); the app consumes the
same values through [`theme.tsx`](../apps/mobile/src/ui/theme.tsx:26).

| Token | Hex | Use |
|---|---|---|
| `brandCyan` | `#0FB5EF` | Mark highlights, chart accents |
| `brandCyanLight` | `#6BDCFA` | Gradient start |
| `brandBlue` | `#0A74D8` | Icon gradient end, primary brand |
| `brandBlueDeep` | `#084A8C` | Pressed states, dark gradients |
| `ink` | `#0B1220` | Dark background, body text on light |
| `inkSoft` | `#1A2433` | Dark cards |
| `paper` | `#F5F8FC` | Light background |
| `white` | `#FFFFFF` | Light cards, white mark |
| `accentLight` | `#0369A1` | Links/actions on light |
| `accentDark` | `#38BDF8` | Links/actions on dark |
| `success` | `#15803D` | Healthy provider dots |
| `warning` | `#B45309` | Limits, stale data |
| `danger` | `#B91C1C` | Errors, destructive actions |

**Gradient:** `#23C6F4 → #0A74D8` at 135°. Use for the launcher icon and splash
background only; in-app surfaces stay flat for legibility.

**Contrast:** body text meets WCAG AA on its intended background. Do not use
`brandCyan` for small text on white; use `accentLight`.

---

## 4. Typography

- **Wordmark:** Liberation Sans Bold (SIL OFL 1.1), bundled at
  [`brand/fonts/LiberationSans-Bold.ttf`](../brand/fonts/LiberationSans-Bold.ttf)
  so rasterization is deterministic on any machine.
- **App UI:** the platform system font. No custom font is loaded at runtime in
  v0.2; this keeps the APK small and avoids licensing complexity.
- **Scale:** display 32, title 20, body 15, caption 12 (tokens in
  [`brand/tokens.json`](../brand/tokens.json)).
- **Case:** Sentence case. The wordmark uses the single camel-case form
  **OpenRator**.

---

## 5. Icon grid

| Property | Value |
|---|---|
| Adaptive canvas | 108 × 108 dp |
| Safe zone | 66 × 66 dp (61%) |
| Legacy PNG | 1024 × 1024 |
| Background | Brand gradient, full bleed |
| Foreground | White mark, centered in the safe zone |
| Monochrome | Black mark on transparent; the OS tints it |

Generated files:

- [`apps/mobile/assets/icon.png`](../apps/mobile/assets/icon.png)
- [`apps/mobile/assets/android-icon-foreground.png`](../apps/mobile/assets/android-icon-foreground.png)
- [`apps/mobile/assets/android-icon-background.png`](../apps/mobile/assets/android-icon-background.png)
- [`apps/mobile/assets/android-icon-monochrome.png`](../apps/mobile/assets/android-icon-monochrome.png)
- [`apps/mobile/assets/splash-icon.png`](../apps/mobile/assets/splash-icon.png)
- [`apps/mobile/assets/favicon.png`](../apps/mobile/assets/favicon.png)
- [`apps/mobile/assets/notification-icon.png`](../apps/mobile/assets/notification-icon.png)

Notification icons must be **white on transparent**; Android tints them.

---

## 6. In-app icon set

Tab and utility glyphs mirror [`brand/svg/icons/`](../brand/svg/icons) and are
implemented as React Native SVG components in
[`icons.tsx`](../apps/mobile/src/ui/icons.tsx:1).

| Glyph | Use |
|---|---|
| `home` | Home tab |
| `spend` | Spend tab |
| `providers` | Providers tab |
| `keys` | Keys tab |
| `settings` | Manage accounts / settings |
| `bell` | Alerts |
| `chevron-right` | Row navigation |
| `external` | Dashboard deep links |
| `plus` | Add provider / create key |
| `alert` | Warnings and blocked states |

Stroke width is 1.8 at 24 px; use `currentColor`-style passing through the
`color` prop.

---

## 7. Trademark and provider marks

- The launcher icon and splash contain **no third-party logos or wordmarks**.
- In-app provider identity uses neutral monograms (`OR`, `Z`) and text labels,
  not official OpenRouter or OpenCode artwork.
- Copy may say "Compatible with OpenRouter" or "Works with OpenCode Zen"; do not
  imply endorsement or partnership.
- Deep links point to the providers' own dashboards for settings the API does
  not expose.

---

## 8. Open decisions

1. **Tagline:** currently **"One pane for every AI bill"**. Alternatives:
   "Your AI spend companion" and "OpenRouter and OpenCode, at a glance".
2. **Accent:** light-theme actions use `#0369A1`; the launcher gradient uses the
   brighter cyan. Confirm whether the app accent should also move to cyan.
3. **Wordmark:** confirm the lockup stays eagle/chevron-led rather than becoming
   letter-led in a future redesign.
