# OpenRator — provider integrations (M8)

Grounding: [`plans/v0.2.0-plan.md`](../plans/v0.2.0-plan.md) §5 (M8),
[`providers/registry.ts`](../apps/mobile/src/providers/registry.ts), and
[`providers/types.ts`](../apps/mobile/src/providers/types.ts).

> **Status: fixture-backed / provisional.** M8.1 (live OpenCode spike) has not
> been executed yet because no OpenCode Go/Zen key and endpoint capture were
> available. No live OpenCode call is made. The adapters accept fixtures in
> tests; the app ships the capability gates plus a clearly-labeled manual
> fallback. Nothing in this document claims an API exists.

## Products and accounting units

| Product | Billing model | Unit | Windows |
|---|---|---|---|
| OpenCode Go | Subscription plan | Percentage of allowance (`usedPct`, 0–100) | 5 hours, weekly, monthly |
| OpenCode Zen | Pay-as-you-go | Microcents, normalized to USD | Balance + usage totals |

### Microcent conversion

`MICROCENTS_PER_USD = 100_000_000` (1 microcent = 1e-6 cent = 1e-8 USD),
defined once in [`providers/opencode/common.ts`](../apps/mobile/src/providers/opencode/common.ts).
Adapters convert to USD before the value reaches SQLite or a screen, so the
domain model only carries USD. If the spike shows a different wire unit, change
that constant and its tests only.

### Plan windows

`AccountSnapshot.plan.windows` / `planWindows` carry:

```ts
{ window: 'five_hour' | 'weekly' | 'monthly', usedPct: number, resetsAt?: string | null }
```

Values are clamped to `0..100`. The sync engine persists them as
`provider.<id>.plan.window.<window>.used_pct` and
`provider.<id>.plan.window.<window>.resets_at`; the Home pane rebuilds the card
from those settings (offline-safe).

## Capability matrix

| Capability | OpenRouter | OpenCode Go | OpenCode Zen |
|---|---|---|---|
| `accountBalance` | yes | no | pending verification (fixture may advertise) |
| `spendWindows` | yes | no | pending verification |
| `activityHistory` | yes (mgmt) | no | no |
| `keyManagement` | yes (mgmt) | no | no |
| `providerCatalog` | yes | no | no |
| `routingPolicy` | yes | no | no |
| `subscriptionPlan` | no | yes | no |
| `planWindows` | no | yes | no |
| `manualBudget` | no | yes | yes |

Rules enforced by the UI:

- Keys and Provider Policy tabs render an explainer, never a fake control, when
  the active scope lacks `keyManagement` / `providerCatalog` / `routingPolicy`.
- Home hides the credits card when no provider in scope advertises
  `accountBalance`; it shows the plan-window card for Go and the manual-budget
  card for either OpenCode product.
- Spend shows an endpoint-analytics explainer plus key windows + manual amount
  when activity history is unsupported.

## Manual fallback (M8.5)

The `usage_manual` table (schema v4) stores one `(provider, month)` amount in
USD with a `note`. Accounts → **Manual tracking** writes it and, for Go, the
plan name plus the three percentage windows. Every surface labels these values
`user-entered`; they are never mixed silently into API-derived numbers.

## Security

- The static secrets guard allows exactly `openrouter.ai`,
  `stats.openrouter.ai`, and `opencode.ai`.
- Provider keys live only in `expo-secure-store` under
  `provider.<id>.key`; fixtures and tests use obvious non-secret literals.
- No raw key is written to SQLite, logs, notifications, or settings.

## M8.1 checklist (when a real key is available)

1. Capture base URL, auth header, key prefix/format.
2. Capture the Go plan response: window names, reset semantics, percent scale.
3. Capture the Zen balance/usage response and confirm the microcent divisor.
4. Confirm rate limits and error bodies; extend the error taxonomy if needed.
5. Replace provisional fixtures, enable `accountBalance`/`spendWindows` for Zen,
   and update this matrix.
