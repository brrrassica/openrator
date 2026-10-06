# OpenRator

Single-pane-of-glass Android app for your **OpenRouter** usage. Credits at a
glance, browsable usage history, upstream provider policy controls, and API key
oversight — built with Expo / React Native, BYOK on-device (no backend in v0.1).

*The name: OpenRouter + curator.*

## Status

- **M0 (foundation) in progress** — scaffold complete (SDK 57, blank-TS, `apps/mobile`), API spikes verified 2026-10-05 (see `docs/03-spike-notes.md`).
- Estimates: ~21–27 dev-days.

## Docs

- [`docs/01-specification.md`](docs/01-specification.md) — product spec, verified API surface, architecture, decisions
- [`docs/02-roadmap-v0.1.md`](docs/02-roadmap-v0.1.md) — v0.1 roadmap (M0–M5), effort, exit criteria

## Confirmed decisions (2026-10-05)

| D | Decision |
|---|---|
| D1 | Expo / React Native (true Android app from React/TS) |
| D2 | BYOK on-device, no backend in v0.1 |
| D3 | Provider controls = Presets-based policy editor + read-only reflection + deep-link to dashboard privacy settings |
| D4 | Personal tool first; productize after v0.2 validation |
| D6 | iOS out of v0.1 (same codebase later) |

## Status

Planning (M0 not yet started).