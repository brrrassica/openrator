# OpenRator — provider integrations (M8)

Grounding: [`plans/v0.2.0-plan.md`](../plans/v0.2.0-plan.md) §5 (M8),
[`providers/registry.ts`](../apps/mobile/src/providers/registry.ts), and
[`providers/types.ts`](../apps/mobile/src/providers/types.ts).

> **Status: OpenCode Go live; Zen provisional.** The Go allowance endpoint was
> captured and verified on 2026-11-01 with a real key, so OpenCode Go now syncs
> its percentage windows automatically. OpenCode Zen still ships fixture-backed
> behind a manual fallback until its balance endpoint is verified. Adapters
> accept fixtures for contract tests.

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

### Live transport (OpenCode Go, verified)

```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer oc_sk_...
Accept: application/json
```

Authentication is the API key alone; no workspace/org header is required. The
response reports every rolling window as a percentage of the plan allowance:

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 2, "resetsAt": "2026-11-01T09:18:48.000Z" },
    "weekly":  { "status": "ok", "percent": 13, "resetsAt": "2026-11-02T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 6, "resetsAt": "2026-11-30T02:22:37.000Z" }
  }
}
```

`rolling` maps to `five_hour`. `status` is `ok` or `rate-limited`; any non-`ok`
meter sets the plan status to `limited`. `resetsAt` is ISO-8601. The adapter
clamps percentages to `0..100` and degrades to zero/empty values if the shape
changes. See [`providers/opencode/client.ts`](../apps/mobile/src/providers/opencode/client.ts).

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

For OpenCode Go the percentage windows are **API-derived**; they are no longer
entered by hand. The manual card only records an optional monthly dollar amount.

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

## M8.1 checklist

1. ✅ Capture base URL, auth header, key prefix/format.
2. ✅ Capture the Go plan response: window names, reset semantics, percent scale.
3. ⬜ Capture the Zen balance/usage response and confirm the microcent divisor.
4. ⬜ Confirm Zen rate limits and error bodies; extend the error taxonomy if needed.
5. ⬜ Enable `accountBalance`/`spendWindows` for Zen and update this matrix.
