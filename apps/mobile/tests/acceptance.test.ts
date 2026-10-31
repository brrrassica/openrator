import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, afterAll } from 'vitest';
import {
  AcceptanceReport,
  BuildFacts,
  renderAcceptanceJson,
  renderAcceptanceMarkdown,
  runAcceptanceChecks,
  statusOf,
  summarizeAcceptance,
} from '../src/qa/acceptance';
import { ACCEPTANCE_FIXTURES } from './acceptance-fixtures';

/**
 * M5.5 — device-independent acceptance pass over spec §11.
 *
 * `npm run acceptance` sets ACCEPTANCE_REPORT=1 and regenerates
 * docs/04-qa-acceptance.md from the same checks asserted here.
 */
const report: AcceptanceReport = await runAcceptanceChecks(ACCEPTANCE_FIXTURES);
const REPORT_PATH = new URL('../../../docs/04-qa-acceptance.md', import.meta.url);
const JSON_PATH = new URL('../../../docs/04-qa-acceptance.json', import.meta.url);

afterAll(() => {
  if (process.env.ACCEPTANCE_REPORT === '1') {
    writeFileSync(REPORT_PATH, renderAcceptanceMarkdown(report), 'utf8');
    writeFileSync(JSON_PATH, renderAcceptanceJson(report), 'utf8');
  }
});

describe('committed acceptance report is fresh (M5.5 CI gate)', () => {
  it('matches a fresh run when ACCEPTANCE_VERIFY=1', () => {
    if (process.env.ACCEPTANCE_VERIFY !== '1') return;
    const committed = readFileSync(REPORT_PATH, 'utf8');
    expect(
      committed,
      'docs/04-qa-acceptance.md is stale — run `npm run acceptance` and commit the result',
    ).toBe(renderAcceptanceMarkdown(report));

    const committedJson = readFileSync(JSON_PATH, 'utf8');
    expect(
      committedJson,
      'docs/04-qa-acceptance.json is stale — run `npm run acceptance` and commit the result',
    ).toBe(renderAcceptanceJson(report));
  });
});

describe('machine-readable acceptance summary (M5.5)', () => {
  it('matches the rendered statuses', () => {
    const summary = summarizeAcceptance(report);
    expect(summary.total).toBe(7);
    expect(summary.green + summary.yellow + summary.red).toBe(summary.total);
    expect(summary.red).toBe(0);
    expect(summary.automatedFailures).toBe(0);
    expect(summary.green).toBe(1);
    expect(summary.yellow).toBe(6);
  });

  it('renders stable JSON with one entry per criterion', () => {
    const json = JSON.parse(renderAcceptanceJson(report)) as {
      summary: { total: number };
      checks: Array<{ id: number; status: string; assertions: unknown[] }>;
    };
    expect(json.summary.total).toBe(7);
    expect(json.checks.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(json.checks.every((c) => c.assertions.length > 0)).toBe(true);
  });
});

describe('§11 acceptance checks are all executable', () => {
  it('runs one check per acceptance criterion', () => {
    expect(report.checks.map((c) => c.row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  for (const { row, assertions } of report.checks) {
    it(`#${row.id} automated portion passes: ${row.criterion}`, () => {
      const failed = assertions.filter((a) => !a.ok);
      expect(
        failed,
        failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ''}`).join('; '),
      ).toEqual([]);
      expect(row.automated).toBe(true);
    });
  }
});

describe('§11 criterion 7 fails closed (M5.5 regression guard)', () => {
  async function criterionSeven(overrides: Partial<BuildFacts>) {
    const fresh = await runAcceptanceChecks({
      ...ACCEPTANCE_FIXTURES,
      build: { ...ACCEPTANCE_FIXTURES.build, ...overrides },
    });
    const check = fresh.checks.find((c) => c.row.id === 7);
    if (!check) throw new Error('criterion 7 missing');
    return check;
  }

  it('passes on the real manifests', async () => {
    const check = await criterionSeven({});
    expect(check.row.automated).toBe(true);
  });

  it('fails when app.json and release.json versions drift', async () => {
    const check = await criterionSeven({ appVersion: '9.9.9' });
    expect(check.row.automated).toBe(false);
    expect(check.assertions.find((a) => a.name.includes('versions agree'))?.ok).toBe(false);
  });

  it('fails when the versionCode does not match the release record', async () => {
    const check = await criterionSeven({ androidVersionCode: 99 });
    expect(check.row.automated).toBe(false);
  });

  it('fails when the EAS production profile is missing', async () => {
    const check = await criterionSeven({ easProduction: null });
    expect(check.row.automated).toBe(false);
    expect(check.assertions.find((a) => a.name.includes('EAS production'))?.ok).toBe(false);
  });

  it('fails when the changelog has no entry for the release', async () => {
    const check = await criterionSeven({ changelog: '# no releases here' });
    expect(check.row.automated).toBe(false);
  });

  it('fails when an artifact release has a malformed checksum', async () => {
    const check = await criterionSeven({
      release: { ...ACCEPTANCE_FIXTURES.build.release, status: 'artifact', sha256: 'not-a-sha' },
    });
    expect(check.row.automated).toBe(false);
  });

  it('fails when an artifact release has no APK commit', async () => {
    const check = await criterionSeven({
      release: { ...ACCEPTANCE_FIXTURES.build.release, status: 'artifact', commit: '' },
    });
    expect(check.row.automated).toBe(false);
  });

  it('fails when a source release fabricates an APK identity', async () => {
    const check = await criterionSeven({
      release: {
        ...ACCEPTANCE_FIXTURES.build.release,
        status: 'source',
        buildId: 'abc',
        commit: '805ac83',
        sha256: '0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b',
      },
    });
    expect(check.row.automated).toBe(false);
  });
});

describe('acceptance status mapping', () => {
  it('only credential hygiene is fully green; device rows stay yellow', () => {
    const statuses = Object.fromEntries(report.checks.map((c) => [c.row.id, statusOf(c.row)]));
    expect(statuses[6]).toBe('green');
    expect([1, 2, 3, 4, 5, 7].every((id) => statuses[id] === 'yellow')).toBe(true);
  });

  it('every green/yellow row carries evidence text', () => {
    for (const { row } of report.checks) {
      expect(row.evidence.length).toBeGreaterThan(0);
    }
  });

  it('renders a markdown table with one row per criterion', () => {
    const md = renderAcceptanceMarkdown(report);
    expect(md).toContain('| # | §11 criterion | Automated | Device | Status | Evidence |');
    for (let id = 1; id <= 7; id++) expect(md).toContain(`| ${id} |`);
  });
});
