import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DeviceRun,
  ExpectedRelease,
  renderDeviceEvidence,
  validateDeviceRun,
} from '../src/qa/device-run';
import { validateDeviceEvidence } from '../src/qa/device-evidence';
import { RELEASE_JSON } from './helpers/manifests';

/**
 * M5.4 — device-run evidence pipeline.
 *
 * `docs/device-run.example.json` documents the input schema and is deliberately
 * rejected as evidence. `npm run evidence:init` (EVIDENCE_RENDER=1) renders a
 * dated file from `docs/device-run.json`; the committed example is never
 * rendered, so CI cannot turn a template into a fake green device row.
 */

const DOCS = new URL('../../../docs/', import.meta.url);
const EXAMPLE = JSON.parse(
  readFileSync(new URL('device-run.example.json', DOCS), 'utf8'),
) as DeviceRun & { $comment?: string };

/** Identity baked into the example run, used to exercise the matcher. */
const expected: ExpectedRelease = {
  version: EXAMPLE.version,
  versionCode: EXAMPLE.versionCode,
  buildId: EXAMPLE.apkBuildId,
  sha256: EXAMPLE.apkSha256,
  commit: EXAMPLE.commit,
};

/** Current release identity; source-only releases have no APK to match. */
const liveExpected: ExpectedRelease | undefined =
  RELEASE_JSON.status === 'source'
    ? undefined
    : {
        version: RELEASE_JSON.version,
        versionCode: RELEASE_JSON.versionCode,
        buildId: RELEASE_JSON.buildId ?? '',
        sha256: RELEASE_JSON.sha256 ?? '',
        commit: RELEASE_JSON.commit ?? '',
      };

function completeRun(overrides: Partial<DeviceRun> = {}): DeviceRun {
  const { $comment: _ignore, ...rest } = EXAMPLE;
  return { ...rest, example: false, ...overrides };
}

const withDevice = (index: number, patch: Partial<DeviceRun['devices'][number]>): DeviceRun => {
  const run = completeRun();
  const devices = run.devices.map((d, i) => (i === index ? { ...d, ...patch } : d));
  return { ...run, devices };
};

const withSignOff = (patch: Partial<DeviceRun['signOff']>): DeviceRun => {
  const run = completeRun();
  return { ...run, signOff: { ...run.signOff, ...patch } };
};

describe('device-run validation', () => {
  it('rejects the example record as evidence', () => {
    const report = validateDeviceRun(EXAMPLE, expected);
    expect(report.ok).toBe(false);
    expect(report.findings.find((f) => f.name === 'run is not the example template')?.ok).toBe(false);
  });

  it('accepts a complete two-device run matching the release record', () => {
    const report = validateDeviceRun(completeRun(), expected);
    const failed = report.findings.filter((f) => !f.ok);
    expect(failed, failed.map((f) => `${f.name} (${f.detail})`).join('; ')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('rejects a soak shorter than 72 h', () => {
    const report = validateDeviceRun(withDevice(0, { soakHours: 71 }), expected);
    expect(report.ok).toBe(false);
    expect(report.findings.find((f) => f.name === '72 h crash-free soak (Pixel 7)')?.ok).toBe(false);
  });

  it('rejects a crash during the soak', () => {
    const report = validateDeviceRun(withDevice(1, { crashFree: false }), expected);
    expect(report.ok).toBe(false);
  });

  it('rejects cold starts at or over the 10 s budget', () => {
    const report = validateDeviceRun(withDevice(0, { coldMs: 10_000 }), expected);
    expect(report.findings.find((f) => f.name === 'start budgets pass (Pixel 7)')?.ok).toBe(false);
  });

  it('rejects warm starts at or over the 2 s budget', () => {
    const report = validateDeviceRun(withDevice(1, { warmMs: 2_000 }), expected);
    expect(report.ok).toBe(false);
  });

  it('requires at least two devices', () => {
    const run = completeRun();
    const report = validateDeviceRun({ ...run, devices: [run.devices[0]] }, expected);
    expect(report.findings.find((f) => f.name === 'two devices are recorded')?.ok).toBe(false);
  });

  it('rejects duplicate device labels', () => {
    const report = validateDeviceRun(
      withDevice(1, { device: EXAMPLE.devices[0].device }),
      expected,
    );
    expect(report.findings.find((f) => f.name === 'device labels are distinct')?.ok).toBe(false);
  });

  it('rejects an Android version below the v0.1 target', () => {
    const report = validateDeviceRun(withDevice(0, { androidVersion: 11 }), expected);
    expect(report.ok).toBe(false);
  });

  it('rejects placeholder criterion evidence', () => {
    const run = completeRun();
    const criteria = run.criteria.map((c) => (c.id === 3 ? { ...c, deviceB: '____' } : c));
    const report = validateDeviceRun({ ...run, criteria }, expected);
    expect(report.findings.find((f) => f.name === 'criterion 3')?.ok).toBe(false);
  });

  it('rejects a run that does not match the recorded release', () => {
    const report = validateDeviceRun(completeRun({ commit: 'deadbee' }), expected);
    expect(report.findings.find((f) => f.name === 'run identity matches the recorded release')?.ok).toBe(false);
  });

  it('rejects an unregenerated acceptance report', () => {
    const report = validateDeviceRun(completeRun({ acceptanceRegenerated: false }), expected);
    expect(report.ok).toBe(false);
  });

  it('rejects an unchecked sign-off box', () => {
    const report = validateDeviceRun(withSignOff({ soakB: false }), expected);
    expect(report.findings.find((f) => f.name === 'soak passed on device B')?.ok).toBe(false);
  });
});

describe('device-run rendering', () => {
  it('renders a document the strict evidence validator accepts', () => {
    const markdown = renderDeviceEvidence(completeRun());
    const report = validateDeviceEvidence(markdown);
    const failed = report.findings.filter((f) => !f.ok);
    expect(failed, failed.map((f) => `${f.name} (${f.detail})`).join('; ')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('includes both devices, all device criteria, and sign-off rows', () => {
    const markdown = renderDeviceEvidence(completeRun());
    expect(markdown).toContain('Pixel 7');
    expect(markdown).toContain('Pixel 4a');
    for (const id of [1, 2, 3, 4, 5, 7]) expect(markdown).toContain(`| ${id} |`);
    expect(markdown).toContain('| Sideload on Device A | [x] pass / [ ] fail |');
    expect(markdown).toContain('| Tag `v0.1.0` pushed to Gitea | [x] yes |');
    expect(markdown).toContain('| Optional M0.5A `/activity` shape capture | [ ] yes / [x] deferred |');
  });

  it('renders a failed sign-off as failed, not as a checked box', () => {
    const markdown = renderDeviceEvidence(
      withSignOff({ sideloadA: false, sideloadB: false, soakA: false, soakB: false }),
    );
    expect(markdown).toContain('| Sideload on Device A | [ ] pass / [x] fail |');
    expect(markdown).toContain('| 72 h crash-free soak (B) | [ ] pass / [x] fail |');
    // No row may carry two checked boxes, and none may claim a pass.
    for (const row of ['Sideload on Device A', 'Sideload on Device B', '72 h crash-free soak (A)', '72 h crash-free soak (B)']) {
      const line = markdown.split('\n').find((l) => l.includes(`| ${row} |`)) ?? '';
      expect(line).not.toContain('[x] pass');
      expect(line.match(/\[x\]/g) ?? []).toHaveLength(1);
    }
  });

  it('the strict validator rejects an all-failed sign-off render', () => {
    const markdown = renderDeviceEvidence(
      withSignOff({ sideloadA: false, sideloadB: false, soakA: false, soakB: false }),
    );
    const report = validateDeviceEvidence(markdown);
    expect(report.ok).toBe(false);
    for (const row of ['Sideload on Device A', 'Sideload on Device B', '72 h crash-free soak (A)', '72 h crash-free soak (B)']) {
      expect(report.findings.find((f) => f.name === row)?.ok, row).toBe(false);
    }
  });

  it('renders deterministically', () => {
    expect(renderDeviceEvidence(completeRun())).toBe(renderDeviceEvidence(completeRun()));
  });

  it('renders a dated evidence file when EVIDENCE_RENDER=1', () => {
    if (process.env.EVIDENCE_RENDER !== '1') return;
    const file = process.env.DEVICE_RUN_FILE
      ? new URL(process.env.DEVICE_RUN_FILE, `file://${process.cwd()}/`)
      : new URL('device-run.json', DOCS);
    expect(existsSync(file), `missing run file: ${file.pathname} (copy device-run.example.json)`).toBe(true);
    const run = JSON.parse(readFileSync(file, 'utf8')) as DeviceRun;
    const report = validateDeviceRun(run, liveExpected);
    const failed = report.findings.filter((f) => !f.ok);
    expect(failed, failed.map((f) => `${f.name} (${f.detail})`).join('; ')).toEqual([]);
    const out = new URL(`04-device-evidence-${run.date}.md`, DOCS);
    writeFileSync(out, renderDeviceEvidence(run), 'utf8');
  });
});
