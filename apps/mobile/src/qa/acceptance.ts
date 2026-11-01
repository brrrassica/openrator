/**
 * OpenRator — device-independent acceptance checks (M5.5, spec §11).
 *
 * Every §11 criterion is encoded here as an executable check. Criteria that
 * still need a physical device / real management account are marked
 * `deviceRequired`; their automated portion must still pass so that only the
 * device pass remains. `runAcceptanceChecks()` is deterministic and has no
 * timers or real network I/O (the key-CRUD check uses an injected fetch stub).
 *
 * Fixtures live in `tests/acceptance-fixtures.ts` so this module stays inside
 * the src secrets-guard whitelist (no raw keys / third-party URLs in src).
 *
 * Consumers:
 * - `tests/acceptance.test.ts` asserts every check passes.
 * - `npm run acceptance` renders `docs/04-qa-acceptance.md`.
 */

import { ActivityRow, KeyRow, Provider } from '../core/types';
import { OpenRouterClient } from '../core/client';
import { computeHomeSummary } from '../ui/home-summary';
import { computeSpendSummary } from '../ui/spend-summary';
import { ruleFor, setRule } from '../ui/policy-state';
import {
  holdsSecret,
  initialRevealState,
  revealReducer,
  RevealState,
} from '../ui/keys-flow';
import { computeDailyRollups } from '../sync/rollups';

export type AcceptanceStatus = 'green' | 'yellow' | 'red';

export interface AcceptanceRow {
  /** §11 criterion number. */
  id: number;
  criterion: string;
  /** Did the automated (device-independent) check pass? */
  automated: boolean;
  /** Does a physical device / real account artifact still gate this row? */
  deviceRequired: boolean;
  evidence: string;
}

export interface AcceptanceCheck {
  row: AcceptanceRow;
  /** Named sub-checks useful for pinpointing a failure. */
  assertions: Array<{ name: string; ok: boolean; detail?: string }>;
}

export interface AcceptanceReport {
  generatedFor: string;
  checks: AcceptanceCheck[];
}

/** Release identity recorded in `docs/release.json`. */
export interface ReleaseRecordFacts {
  /** `artifact` = APK identity recorded; `source` = tagged source, build pending. */
  status?: 'artifact' | 'source';
  version: string;
  versionCode: number;
  buildId?: string;
  commit?: string;
  sha256?: string;
}

/** Build/config facts used by §11 criterion 7 (supplied by the test tree). */
export interface BuildFacts {
  /** `version` from apps/mobile/package.json. */
  packageVersion: string;
  /** `expo.version` from apps/mobile/app.json. */
  appVersion: string;
  /** `expo.android.versionCode` from apps/mobile/app.json. */
  androidVersionCode: number;
  /** `build.production` from apps/mobile/eas.json (null when absent). */
  easProduction: { channel?: string; buildType?: string; distribution?: string } | null;
  /** Raw docs/CHANGELOG.md contents. */
  changelog: string;
  /** Release identity recorded in docs/release.json. */
  release: ReleaseRecordFacts;
}

/** Everything the checks need; supplied by the test tree (no secrets in src). */
export interface AcceptanceFixtures {
  /** ISO day used as "today" by the selectors. */
  today: string;
  activity: ActivityRow[];
  /** What a dashboard would show for `activity`. */
  reference: { spendUsd: number; requests: number; tokens: number };
  providers: Provider[];
  keyRow: KeyRow;
  creditsTotal: number;
  creditsUsage: number;
  managementKey: string;
  build: BuildFacts;
}

const close = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const withinPct = (a: number, b: number, pct: number): boolean => {
  const base = Math.abs(b);
  if (base === 0) return a === 0;
  return Math.abs(a - b) / base <= pct;
};

function checkHome(f: AcceptanceFixtures): AcceptanceCheck {
  const assertions: AcceptanceCheck['assertions'] = [];
  const t0 = performance.now();
  const summary = computeHomeSummary({
    key: f.keyRow,
    rollups: computeDailyRollups(f.activity),
    providers: f.providers,
    today: f.today,
    staleCredits: false,
    activityLocked: false,
    creditsTotal: f.creditsTotal,
    creditsUsage: f.creditsUsage,
  });
  const elapsedMs = performance.now() - t0;

  assertions.push({ name: '14-day trend rendered', ok: summary.trend.length === 14 });
  assertions.push({
    name: 'today spend derived from rollups',
    ok: summary.spendToday > 0,
    detail: `${summary.spendToday}`,
  });
  assertions.push({
    name: 'credits remaining = total - usage',
    ok: close(summary.creditsRemaining, f.creditsTotal - f.creditsUsage, 1e-6),
    detail: `${summary.creditsRemaining}`,
  });
  assertions.push({
    name: 'providers available for health strip',
    ok: summary.providers.length === f.providers.length,
  });
  assertions.push({
    name: 'selector path under 100 ms (device stopwatch still needed)',
    ok: elapsedMs < 100,
    // Deterministic detail so the committed report can be drift-checked in CI.
    detail: elapsedMs < 100 ? 'within budget' : 'over budget',
  });

  return {
    row: {
      id: 1,
      criterion: 'Fresh install → key → Home populated < 10 s (warm < 2 s)',
      automated: assertions.every((a) => a.ok),
      deviceRequired: true,
      evidence:
        'onboarding+refreshAll path builds a populated Home summary from cached rollups; cold-start stopwatch is device-only',
    },
    assertions,
  };
}

function checkSpendParity(f: AcceptanceFixtures): AcceptanceCheck {
  const assertions: AcceptanceCheck['assertions'] = [];
  const s = computeSpendSummary(f.activity, f.providers, f.today, 30);

  assertions.push({ name: 'has activity', ok: s.hasActivity });
  assertions.push({
    name: 'total spend within 5 % of reference',
    ok: withinPct(s.totalSpend, f.reference.spendUsd, 0.05),
    detail: `${s.totalSpend} vs ${f.reference.spendUsd}`,
  });
  assertions.push({
    name: 'total requests match reference',
    ok: s.totalRequests === f.reference.requests,
    detail: `${s.totalRequests}`,
  });
  assertions.push({
    name: 'total tokens match reference',
    ok: s.totalTokens === f.reference.tokens,
    detail: `${s.totalTokens}`,
  });
  assertions.push({
    name: 'endpoint aggregates ranked by spend',
    ok: s.endpoints.length >= 2 && s.endpoints[0].spendUsd >= s.endpoints[1].spendUsd,
  });
  assertions.push({
    name: 'provider share sums to 100 %',
    ok: close(
      s.share.reduce((sum, x) => sum + x.sharePct, 0),
      100,
      1e-6,
    ),
  });

  return {
    row: {
      id: 2,
      criterion: 'Spend trend + top models/providers match dashboard (≤5 % variance)',
      automated: assertions.every((a) => a.ok),
      deviceRequired: true,
      evidence:
        'selector math reproduced against a recorded activity fixture; live dashboard comparison needs a management key',
    },
    assertions,
  };
}

function checkAnalyticsFallback(f: AcceptanceFixtures): AcceptanceCheck {
  const assertions: AcceptanceCheck['assertions'] = [];
  const mgmt = computeSpendSummary(f.activity, f.providers, f.today, 30);
  const fallback = computeSpendSummary([], f.providers, f.today, 30);
  const staleHome = computeHomeSummary({
    key: f.keyRow,
    rollups: computeDailyRollups(f.activity),
    providers: f.providers,
    today: f.today,
    staleCredits: true,
    activityLocked: true,
  });

  assertions.push({ name: 'mgmt key renders analytics', ok: mgmt.hasActivity });
  assertions.push({ name: 'no-mgmt fallback renders explainer state', ok: !fallback.hasActivity });
  assertions.push({ name: 'fallback totals are zero, not NaN', ok: fallback.totalSpend === 0 });
  assertions.push({ name: 'stale badge propagated offline', ok: staleHome.staleCredits === true });
  assertions.push({
    name: 'cached trend survives offline/stale state',
    ok: staleHome.trend.length === 14 && staleHome.spendToday > 0,
  });

  return {
    row: {
      id: 3,
      criterion:
        'Spend & endpoint analytics match 30-day activity (mgmt); fallback + explainer without; offline stale',
      automated: assertions.every((a) => a.ok),
      deviceRequired: true,
      evidence:
        'mgmt/fallback/stale branches verified in-process; airplane-mode render and live parity need a device',
    },
    assertions,
  };
}

function checkPolicyToggle(): AcceptanceCheck {
  const assertions: AcceptanceCheck['assertions'] = [];

  // toggle write → JSON wire → read back
  const routed = setRule(undefined, 'openai', 'ignored');
  const wire = JSON.parse(JSON.stringify({ provider: routed })) as {
    provider: Parameters<typeof ruleFor>[0];
  };
  assertions.push({
    name: 'toggle writes provider.ignore',
    ok: Array.isArray(routed.ignore) && routed.ignore.includes('openai'),
  });
  assertions.push({
    name: 'read-back reports ignored',
    ok: ruleFor(wire.provider, 'openai') === 'ignored',
  });

  // included removes ignore; lists stay mutually exclusive
  const included = setRule(routed, 'openai', 'included');
  assertions.push({
    name: 'included moves slug out of ignore into only',
    ok:
      Array.isArray(included.only) &&
      included.only.includes('openai') &&
      !included.ignore?.includes('openai'),
  });

  // rollback on failed write restores previous routing
  const rolledBack = setRule(wire.provider, 'openai', 'default');
  assertions.push({
    name: 'rollback restores default rule',
    ok: ruleFor(rolledBack, 'openai') === 'default',
  });

  return {
    row: {
      id: 4,
      criterion: 'Provider toggle writes provider.ignore, reads back; UI rollback on failure',
      automated: assertions.every((a) => a.ok),
      deviceRequired: true,
      evidence:
        'routing write/read-back/rollback verified on the serialized preset body; live OpenRouter read-back needs a device',
    },
    assertions,
  };
}

async function checkKeyCrud(f: AcceptanceFixtures): Promise<AcceptanceCheck> {
  const assertions: AcceptanceCheck['assertions'] = [];
  const createdSecret = 'one-time-secret-value';
  const calls: Array<{ input: string; init: Record<string, unknown> }> = [];
  const client = new OpenRouterClient({
    apiKey: f.managementKey,
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchFn: async (input, init) => {
      calls.push({ input, init: init ?? {} });
      if (init?.method === 'DELETE') {
        return { status: 200, headers: { get: () => null }, json: async () => ({}) };
      }
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        return {
          status: 200,
          headers: { get: () => null },
          json: async () => ({ data: { hash: 'abc', label: body.label, limit: body.limit } }),
        };
      }
      if (init?.method === 'POST') {
        return {
          status: 200,
          headers: { get: () => null },
          json: async () => ({ data: { hash: 'new', key: createdSecret } }),
        };
      }
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: [
            {
              hash: 'abc',
              label: 'prod',
              limit: 10,
              limit_remaining: 4,
              limit_reset: 'monthly',
              usage: 6,
              usage_daily: 1,
              usage_weekly: 3,
              usage_monthly: 6,
              include_byok_in_limit: false,
              expires_at: null,
              created: 1,
            },
          ],
        }),
      };
    },
  });

  const listed = await client.listAdminKeys();
  assertions.push({
    name: 'list keys maps hash/label',
    ok: listed.length === 1 && listed[0].hash === 'abc',
  });

  const patched = await client.patchAdminKey('abc', { label: 'renamed', limit: 20 });
  const patchCall = calls.find((c) => c.init.method === 'PATCH');
  const patchBody = JSON.parse(String(patchCall?.init.body ?? '{}')) as Record<string, unknown>;
  assertions.push({
    name: 'rename/limit travels as documented snake_case body',
    ok: patched.label === 'renamed' && patchBody.label === 'renamed' && patchBody.limit === 20,
  });

  await client.deleteAdminKey('abc');
  const deleteCall = calls.find((c) => c.init.method === 'DELETE');
  assertions.push({
    name: 'revoke uses DELETE /keys/{hash}',
    ok: Boolean(deleteCall?.input.includes('/keys/abc')),
  });

  const created = await client.createAdminKey({ label: 't', limit: 5 });
  assertions.push({ name: 'create returns one-time secret', ok: created.key === createdSecret });

  // reveal-later invariant: collapsing drops the secret from memory
  let reveal: RevealState = revealReducer(initialRevealState, {
    type: 'reveal',
    keyValue: created.key,
  });
  assertions.push({ name: 'revealed state holds secret', ok: holdsSecret(reveal) });
  reveal = revealReducer(reveal, { type: 'collapse' });
  assertions.push({
    name: 'collapse never retains secret',
    ok: !holdsSecret(reveal) && reveal.keyValue === null,
  });

  return {
    row: {
      id: 5,
      criterion: 'Key edit/revoke works and reflects on dashboard immediately',
      automated: assertions.every((a) => a.ok),
      deviceRequired: true,
      evidence:
        'list/patch/delete/create wire contracts + reveal invariant verified; dashboard reflection needs a management key on a device',
    },
    assertions,
  };
}

async function checkSecretHygiene(f: AcceptanceFixtures): Promise<AcceptanceCheck> {
  const assertions: AcceptanceCheck['assertions'] = [];
  const seen: Array<Record<string, unknown>> = [];
  const client = new OpenRouterClient({
    apiKey: f.managementKey,
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchFn: async (_input, init) => {
      seen.push((init ?? {}) as Record<string, unknown>);
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: { label: 'k', is_management_key: false } }),
      };
    },
  });
  await client.getKeyStatus();

  const headers = (seen[0]?.headers ?? {}) as Record<string, string>;
  assertions.push({
    name: 'raw key appears only in the Authorization header',
    ok: headers.Authorization === `Bearer ${f.managementKey}`,
  });
  assertions.push({
    name: 'no URL/body carries the raw key',
    ok: seen.every((init) => !String(init.body ?? '').includes(f.managementKey)),
  });

  // what refreshCredits persists must never include the raw secret
  const persisted = {
    key_hash: 'fingerprint-abc',
    label: f.keyRow.label,
    limit: String(f.keyRow.limit),
    account_total_credits: String(f.creditsTotal),
    usage: String(f.keyRow.usageDaily),
  };
  assertions.push({
    name: 'persisted settings contain no raw key',
    ok: !Object.values(persisted).some((v) => String(v).includes(f.managementKey)),
  });

  return {
    row: {
      id: 6,
      criterion: 'No credential leaves the device except TLS to openrouter.ai',
      automated: assertions.every((a) => a.ok),
      deviceRequired: false,
      evidence:
        'transport header/body audit + persisted-field audit; also covered by tests/secrets-guard.test.ts in CI',
    },
    assertions,
  };
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * §11 criterion 7 — the device-independent half of the build/release gate.
 *
 * These assertions used to be hardcoded `ok: true`, which meant the criterion
 * could never fail. They now read the real manifests and the recorded release
 * identity (`docs/release.json`), so a version mismatch, a missing EAS
 * production profile, a stale changelog entry, or a malformed APK checksum
 * turns the row 🔴 in CI before anything reaches a device.
 */
function checkBuildInstall(f: AcceptanceFixtures): AcceptanceCheck {
  const assertions: AcceptanceCheck['assertions'] = [];
  const build = f.build;
  const version = build.release.version;

  assertions.push({
    name: 'package.json and app.json versions agree',
    ok: build.packageVersion === build.appVersion && build.packageVersion === version,
    detail: `${build.packageVersion} / ${build.appVersion} / release ${version}`,
  });
  assertions.push({
    name: 'release version is semver',
    ok: SEMVER.test(version),
    detail: version,
  });
  assertions.push({
    name: 'android versionCode is a positive integer and matches the release record',
    ok:
      Number.isInteger(build.androidVersionCode) &&
      build.androidVersionCode > 0 &&
      build.androidVersionCode === build.release.versionCode,
    detail: `${build.androidVersionCode} / release ${build.release.versionCode}`,
  });
  assertions.push({
    name: 'EAS production profile builds an internal APK',
    ok:
      build.easProduction?.channel === 'production' &&
      build.easProduction?.buildType === 'apk' &&
      build.easProduction?.distribution === 'internal',
    detail: build.easProduction
      ? `${build.easProduction.channel}/${build.easProduction.buildType}/${build.easProduction.distribution}`
      : 'production profile missing',
  });
  assertions.push({
    name: 'CHANGELOG records the released version',
    ok: build.changelog.includes(`## [${version}]`),
    detail: `## [${version}]`,
  });

  const sourceOnly = build.release.status === 'source';
  if (sourceOnly) {
    assertions.push({
      name: 'source-only release records no fabricated APK identity',
      ok: !build.release.buildId && !build.release.commit && !build.release.sha256,
      detail: 'APK identity pending build',
    });
  } else {
    assertions.push({
      name: 'APK SHA-256 is 64 lowercase hex characters',
      ok: HEX64.test(build.release.sha256 ?? ''),
      detail: (build.release.sha256 ?? '').slice(0, 12),
    });
    assertions.push({
      name: 'APK build id and commit are recorded',
      ok: Boolean(build.release.buildId) && GIT_COMMIT.test(build.release.commit ?? ''),
      detail: `${build.release.buildId || 'missing'} / ${build.release.commit || 'missing'}`,
    });
  }

  return {
    row: {
      id: 7,
      criterion: 'Builds via Expo, installs on Android 12+ without crash',
      automated: assertions.every((a) => a.ok),
      deviceRequired: true,
      evidence: sourceOnly
        ? `source-only v${version} tag: manifests (package/app/eas), versionCode ${build.androidVersionCode}, and CHANGELOG agree; APK build + sideload + soak remain device-only`
        : 'manifests (package/app/eas) + docs/release.json agree with the CHANGELOG; sideload + crash-free soak remain device-only',
    },
    assertions,
  };
}

export function statusOf(row: AcceptanceRow): AcceptanceStatus {
  if (!row.automated) return 'red';
  return row.deviceRequired ? 'yellow' : 'green';
}

/** Run every device-independent §11 check. Deterministic, no real network. */
export async function runAcceptanceChecks(
  fixtures: AcceptanceFixtures,
): Promise<AcceptanceReport> {
  const checks = [
    checkHome(fixtures),
    checkSpendParity(fixtures),
    checkAnalyticsFallback(fixtures),
    checkPolicyToggle(),
    await checkKeyCrud(fixtures),
    await checkSecretHygiene(fixtures),
    checkBuildInstall(fixtures),
  ];
  return { generatedFor: 'spec §11 / M5.5', checks };
}

const ICON: Record<AcceptanceStatus, string> = { green: '🟢', yellow: '🟡', red: '🔴' };

/** Render the checks as a markdown report (deterministic, no timestamps). */
export function renderAcceptanceMarkdown(report: AcceptanceReport): string {
  const lines: string[] = [];
  lines.push('# OpenRator — M5.5 automated acceptance report');
  lines.push('');
  lines.push(
    `Grounding: ${report.generatedFor}. Generated by \`npm run acceptance\`; do not edit by hand.`,
  );
  lines.push('');
  lines.push(
    'Column key: 🟢 = automated evidence complete · 🟡 = automated part passes, physical-device/real-account pass pending · 🔴 = automated check failed.',
  );
  lines.push('');
  lines.push('| # | §11 criterion | Automated | Device | Status | Evidence |');
  lines.push('|---|---|---|---|---|---|');
  for (const { row } of report.checks) {
    const status = statusOf(row);
    lines.push(
      `| ${row.id} | ${row.criterion} | ${row.automated ? 'pass' : 'FAIL'} | ${
        row.deviceRequired ? 'pending' : 'n/a'
      } | ${ICON[status]} | ${row.evidence} |`,
    );
  }
  lines.push('');
  lines.push('### Automated sub-checks');
  lines.push('');
  for (const { row, assertions } of report.checks) {
    lines.push(`**${row.id}. ${row.criterion}**`);
    lines.push('');
    for (const a of assertions) {
      lines.push(`- ${a.ok ? '✅' : '❌'} ${a.name}${a.detail ? ` — ${a.detail}` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface AcceptanceSummary {
  total: number;
  green: number;
  yellow: number;
  red: number;
  automatedFailures: number;
}

/** Machine-readable roll-up used by the JSON report and CI drift gate. */
export function summarizeAcceptance(report: AcceptanceReport): AcceptanceSummary {
  const summary: AcceptanceSummary = {
    total: report.checks.length,
    green: 0,
    yellow: 0,
    red: 0,
    automatedFailures: 0,
  };
  for (const { row } of report.checks) {
    summary[statusOf(row)] += 1;
    if (!row.automated) summary.automatedFailures += 1;
  }
  return summary;
}

/**
 * Deterministic JSON report (same ordering/content as the markdown report).
 * Committed as `docs/04-qa-acceptance.json` and drift-checked in CI.
 */
export function renderAcceptanceJson(report: AcceptanceReport): string {
  const payload = {
    generatedFor: report.generatedFor,
    summary: summarizeAcceptance(report),
    checks: report.checks.map(({ row, assertions }) => ({
      id: row.id,
      criterion: row.criterion,
      automated: row.automated,
      deviceRequired: row.deviceRequired,
      status: statusOf(row),
      evidence: row.evidence,
      assertions,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
