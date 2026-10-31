import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, afterAll } from 'vitest';
import {
  AcceptanceReport,
  renderAcceptanceMarkdown,
  runAcceptanceChecks,
  statusOf,
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

afterAll(() => {
  if (process.env.ACCEPTANCE_REPORT === '1') {
    writeFileSync(REPORT_PATH, renderAcceptanceMarkdown(report), 'utf8');
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
