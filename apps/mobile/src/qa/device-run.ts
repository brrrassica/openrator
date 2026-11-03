/**
 * OpenRator — device-run evidence pipeline (M5.4).
 *
 * The device pass used to be hand-written into a copy of the evidence
 * template. That made it easy to record a 40 h soak, a cold start over budget,
 * or a single device and still leave the validator green. This module takes a
 * typed run record, applies the same budgets as `start-budget.ts`, and renders
 * the dated evidence file the existing validator expects.
 *
 * Pure (no filesystem): `tests/device-run.test.ts` feeds it the committed run
 * file and (only with `EVIDENCE_RENDER=1`) writes
 * `docs/04-device-evidence-<date>.md`.
 */

import { DEVICE_CRITERIA } from './device-evidence';
import { evaluateStartBudget } from './start-budget';

export interface DeviceMeasurement {
  /** Human label shown in the matrix (e.g. "Pixel 7"). */
  device: string;
  /** Android API level / major version (must be >= 12). */
  androidVersion: number;
  coldMs: number;
  warmMs: number;
  selectorMs: number;
  /** Crash-free soak duration in hours (must be >= 72). */
  soakHours: number;
  crashFree: boolean;
  notes?: string;
}

export interface DeviceCriterionEvidence {
  /** §11 criterion id (1–5 or 7; criterion 6 is device-independent). */
  id: number;
  /** What evidence was captured. */
  evidence: string;
  deviceA: string;
  deviceB: string;
}

export interface DeviceRunSignOff {
  sideloadA: boolean;
  sideloadB: boolean;
  soakA: boolean;
  soakB: boolean;
  tagPushed: boolean;
  /** M0.5A `/activity` shape capture. */
  activityCapture?: 'yes' | 'deferred';
}

export interface DeviceRun {
  date: string;
  tester: string;
  apkBuildId: string;
  apkSha256: string;
  version: string;
  versionCode: number;
  commit: string;
  /** A dated evidence copy is only valid if the acceptance report was refreshed. */
  acceptanceRegenerated: boolean;
  devices: DeviceMeasurement[];
  criteria: DeviceCriterionEvidence[];
  signOff: DeviceRunSignOff;
  /** Guard so the example file can never be rendered as real evidence. */
  example?: boolean;
}

export interface DeviceRunFinding {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DeviceRunReport {
  ok: boolean;
  findings: DeviceRunFinding[];
}

export interface ExpectedRelease {
  version: string;
  versionCode: number;
  buildId: string;
  sha256: string;
  commit: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{7,40}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER = /_{2,}/;

const CRITERIA_TEXT: Record<number, string> = {
  1: 'Fresh install → key → Home populated < 10 s (warm < 2 s)',
  2: 'Spend trend + top models/providers match dashboard (≤ 5 %)',
  3: 'Analytics match 30-day activity (mgmt); fallback + explainer without; offline stale',
  4: 'Provider toggle writes `provider.ignore`, reads back; rollback on failure',
  5: 'Key edit/revoke reflects on dashboard immediately',
  6: 'No credential leaves device except TLS to openrouter.ai',
  7: 'Builds via Expo, installs on Android 12+ without crash',
};

const filled = (value: string): boolean => value.trim().length > 0 && !PLACEHOLDER.test(value);

/** Validate a device run against the M5.4 budgets and evidence rules. */
export function validateDeviceRun(
  run: DeviceRun,
  expected?: ExpectedRelease,
): DeviceRunReport {
  const findings: DeviceRunFinding[] = [];
  const push = (name: string, ok: boolean, detail: string): void =>
    void findings.push({ name, ok, detail });

  push('run is not the example template', run.example !== true, run.example ? 'example=true' : 'real run');
  push('date is an ISO day', ISO_DAY.test(run.date), run.date || 'missing');
  push('tester is recorded', filled(run.tester), run.tester || 'missing');
  push('APK build id is recorded', filled(run.apkBuildId), run.apkBuildId || 'missing');
  push('APK SHA-256 is 64 lowercase hex', HEX64.test(run.apkSha256), run.apkSha256.slice(0, 12));
  push('version is semver', SEMVER.test(run.version), run.version || 'missing');
  push(
    'versionCode is a positive integer',
    Number.isInteger(run.versionCode) && run.versionCode > 0,
    `${run.versionCode}`,
  );
  push('commit is a git hash', GIT_COMMIT.test(run.commit), run.commit || 'missing');
  push(
    'acceptance report was regenerated',
    run.acceptanceRegenerated === true,
    run.acceptanceRegenerated ? 'yes' : 'no',
  );

  if (expected) {
    push(
      'run identity matches the recorded release',
      run.version === expected.version &&
        run.versionCode === expected.versionCode &&
        run.apkBuildId === expected.buildId &&
        run.apkSha256 === expected.sha256 &&
        run.commit === expected.commit,
      `${run.version}/${run.versionCode}/${run.apkBuildId.slice(0, 8)}/${run.commit}`,
    );
  }

  push('two devices are recorded', run.devices.length >= 2, `${run.devices.length}`);
  const names = new Set(run.devices.map((d) => d.device.trim()).filter(Boolean));
  push('device labels are distinct', names.size === run.devices.length && names.size >= 2, `${names.size}`);
  run.devices.forEach((device, index) => {
    const label = device.device || `device ${index + 1}`;
    const budget = evaluateStartBudget({
      coldMs: device.coldMs,
      warmMs: device.warmMs,
      selectorMs: device.selectorMs,
    });
    push(`Android version supports the v0.1 target (${label})`, device.androidVersion >= 12, `${device.androidVersion}`);
    const failed = budget.checks.filter((c) => !c.ok);
    push(
      `start budgets pass (${label})`,
      budget.ok,
      failed.length === 0 ? 'within budget' : failed.map((c) => `${c.name} ${c.actualMs}ms`).join(', '),
    );
    push(
      `72 h crash-free soak (${label})`,
      device.soakHours >= 72 && device.crashFree === true,
      `${device.soakHours} h / crashFree=${device.crashFree}`,
    );
  });

  for (const id of DEVICE_CRITERIA) {
    const criterion = run.criteria.find((c) => c.id === id);
    if (!criterion) {
      push(`criterion ${id}`, false, 'missing from run');
      continue;
    }
    push(`criterion ${id}`, filled(criterion.deviceA) && filled(criterion.deviceB), 'device A/B evidence');
  }

  push('sideload passed on device A', run.signOff.sideloadA, `${run.signOff.sideloadA}`);
  push('sideload passed on device B', run.signOff.sideloadB, `${run.signOff.sideloadB}`);
  push('soak passed on device A', run.signOff.soakA, `${run.signOff.soakA}`);
  push('soak passed on device B', run.signOff.soakB, `${run.signOff.soakB}`);
  push('v<version> tag pushed', run.signOff.tagPushed, `${run.signOff.tagPushed}`);
  push(
    'M0.5A activity capture is decided',
    run.signOff.activityCapture === 'yes' || run.signOff.activityCapture === 'deferred',
    run.signOff.activityCapture ?? 'missing',
  );

  return { ok: findings.every((f) => f.ok), findings };
}

/** Render the dated, completed evidence document (template-compatible). */
export function renderDeviceEvidence(run: DeviceRun): string {
  const [deviceA, deviceB] = run.devices;
  const lines: string[] = [];
  // The checkbox belongs to the branch that is actually true. Embedding `[x]`
  // in the `yes` label rendered a failed sign-off as `[ ] [x] pass / fail`,
  // which the strict validator then accepted because it only looked for any
  // checked box.
  const yesNo = (value: boolean): string =>
    value ? '[x] pass / [ ] fail' : '[ ] pass / [x] fail';
  const activity =
    run.signOff.activityCapture === 'deferred'
      ? '[ ] yes / [x] deferred'
      : '[x] yes / [ ] deferred';

  lines.push('# OpenRator — device-pass evidence (M5.4/M5.5/M5.6)');
  lines.push('');
  lines.push(
    `Completed copy for the ${run.date} device pass. Generated by \`npm run evidence:init\`; validate with \`npm run acceptance:evidence\`.`,
  );
  lines.push('');
  lines.push('## 0. Run metadata');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Date | ${run.date} |`);
  lines.push(`| APK build id | \`${run.apkBuildId}\` |`);
  lines.push(`| APK SHA-256 | \`${run.apkSha256}\` |`);
  lines.push(`| App version / versionCode | \`${run.version}\` / \`${run.versionCode}\` |`);
  lines.push(`| Commit | \`${run.commit}\` |`);
  lines.push(`| Tester | ${run.tester} |`);
  lines.push(
    `| Acceptance report regenerated (\`npm run acceptance\`) | ${run.acceptanceRegenerated ? '[x] yes' : '[ ] yes'} |`,
  );
  lines.push('');
  lines.push('## 1. Device matrix');
  lines.push('');
  lines.push('| Device | Android | Version | Cold start | Warm start | 72 h soak | Notes |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const device of run.devices) {
    lines.push(
      `| ${device.device} | ${device.androidVersion} | ${run.version} | ${device.coldMs} ms | ${device.warmMs} ms | ${device.soakHours} / 72 h | ${device.notes ?? ''} |`,
    );
  }
  lines.push('');
  lines.push('## 2. §11 acceptance evidence (device portion)');
  lines.push('');
  lines.push('| # | Criterion | Evidence to record | Device A | Device B |');
  lines.push('|---|---|---|---|---|');
  for (const id of DEVICE_CRITERIA) {
    const criterion = run.criteria.find((c) => c.id === id);
    lines.push(
      `| ${id} | ${CRITERIA_TEXT[id]} | ${criterion?.evidence ?? ''} | ${criterion?.deviceA ?? ''} | ${criterion?.deviceB ?? ''} |`,
    );
  }
  lines.push(`| 6 | ${CRITERIA_TEXT[6]} | automated (CI); no device step required | n/a | n/a |`);
  lines.push('');
  lines.push('## 3. M5.4 device flow script');
  lines.push('');
  lines.push('Per device, in order:');
  lines.push('');
  lines.push('1. Fresh install → onboarding (paste key, management toggle) → Home populated.');
  lines.push('2. Spend tab: management key → standard key → airplane mode (stale badge).');
  lines.push('3. Providers catalog: search, sort, status links.');
  lines.push('4. Policy: toggle one provider, reopen the tab, confirm read-back on the dashboard.');
  lines.push('5. Keys: create → reveal → copy → test → collapse → revoke.');
  lines.push('6. Clear stored key → restart → onboarding shown again.');
  lines.push('');
  lines.push('Record any deviation and whether it reproduced on the second device.');
  lines.push('');
  lines.push('## 4. M5.6 release sign-off');
  lines.push('');
  lines.push('| Check | Result |');
  lines.push('|---|---|');
  lines.push(`| Sideload on Device A | ${yesNo(run.signOff.sideloadA)} |`);
  lines.push(`| Sideload on Device B | ${yesNo(run.signOff.sideloadB)} |`);
  lines.push(`| 72 h crash-free soak (A) | ${yesNo(run.signOff.soakA)} |`);
  lines.push(`| 72 h crash-free soak (B) | ${yesNo(run.signOff.soakB)} |`);
  lines.push(`| Tag \`v${run.version}\` pushed to Gitea | ${run.signOff.tagPushed ? '[x] yes' : '[ ] yes'} |`);
  lines.push(`| Optional M0.5A \`/activity\` shape capture | ${activity} |`);
  lines.push('');
  lines.push(
    `Devices: ${deviceA?.device ?? 'A'} (Android ${deviceA?.androidVersion ?? '?'}) and ${deviceB?.device ?? 'B'} (Android ${deviceB?.androidVersion ?? '?'}).`,
  );
  lines.push('');
  return `${lines.join('\n').trimEnd()}\n`;
}
