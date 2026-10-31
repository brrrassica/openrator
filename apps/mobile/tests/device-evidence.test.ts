import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEVICE_CRITERIA, validateDeviceEvidence } from '../src/qa/device-evidence';

/** M5.5/M5.6 — device-evidence structure + strict completion gates. */

const DOCS = new URL('../../../docs/', import.meta.url);
const TEMPLATE = readFileSync(new URL('04-device-evidence-template.md', DOCS), 'utf8');

const COMPLETED = `# evidence
| # | Criterion | Evidence | Device A | Device B |
|---|---|---|---|---|
| 1 | cold | stopwatch | 6.2 s | 7.1 s |
| 2 | parity | delta | 1 % | 2 % |
| 3 | analytics | shots | pass | pass |
| 4 | policy | read-back | pass | pass |
| 5 | keys | shots | pass | pass |
| 6 | secrets | n/a | n/a | n/a |
| 7 | install | soak | pass | pass |

| Check | Result |
|---|---|
| Sideload on Device A | [x] pass / [ ] fail |
| Sideload on Device B | [x] pass / [ ] fail |
| 72 h crash-free soak (A) | [x] pass / [ ] fail |
| 72 h crash-free soak (B) | [x] pass / [ ] fail |
| Tag \`v0.1.0\` pushed to Gitea | [x] yes |
`;

describe('device-evidence validator', () => {
  it('the committed template covers every device criterion and sign-off row', () => {
    const report = validateDeviceEvidence(TEMPLATE, { template: true });
    expect(report.findings.filter((f) => !f.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('the template itself is not a completed pass', () => {
    const report = validateDeviceEvidence(TEMPLATE);
    expect(report.ok).toBe(false);
    expect(report.findings.filter((f) => !f.ok).length).toBeGreaterThan(0);
  });

  it('a fully filled evidence file passes strict validation', () => {
    const report = validateDeviceEvidence(COMPLETED);
    expect(report.findings.filter((f) => !f.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('fails strict validation when one device cell is a placeholder', () => {
    const broken = COMPLETED.replace('| 2 | parity | delta | 1 % | 2 % |', '| 2 | parity | delta | 1 % | ____ |');
    const report = validateDeviceEvidence(broken);
    expect(report.ok).toBe(false);
    expect(report.findings.find((f) => f.name === 'criterion 2')?.ok).toBe(false);
  });

  it('fails when a sign-off box is unchecked', () => {
    const broken = COMPLETED.replace('| 72 h crash-free soak (A) | [x] pass / [ ] fail |', '| 72 h crash-free soak (A) | [ ] pass / [ ] fail |');
    const report = validateDeviceEvidence(broken);
    expect(report.ok).toBe(false);
    expect(report.findings.find((f) => f.name === '72 h crash-free soak (A)')?.ok).toBe(false);
  });

  it('lists the device-gated criteria', () => {
    expect([...DEVICE_CRITERIA]).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it('any completed evidence copy in docs/ is complete', () => {
    const completed = readdirSync(DOCS).filter(
      (f) => /^04-device-evidence-.+\.md$/.test(f) && !f.includes('template'),
    );
    for (const name of completed) {
      const report = validateDeviceEvidence(readFileSync(new URL(name, DOCS), 'utf8'));
      expect(
        report.findings.filter((f) => !f.ok),
        `${name} is incomplete — fill every device cell and sign-off box`,
      ).toEqual([]);
    }
  });
});
