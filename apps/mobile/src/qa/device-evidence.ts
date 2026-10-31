/**
 * OpenRator — device-pass evidence validator (M5.4/M5.5/M5.6).
 *
 * The automated acceptance harness can only go so far; §11 criteria 1–5 and 7
 * require a physical device / real management account. This module validates
 * the completed evidence file so a 🟡 row cannot be marked green without
 * recorded evidence.
 *
 * - `template: true` validates that the *template* still covers every criterion
 *   and sign-off row (structure gate — safe to run in CI).
 * - `template: false` validates a *completed* copy and fails on any placeholder
 *   (`____`) or unchecked sign-off box (strict device gate).
 */

export interface EvidenceFinding {
  name: string;
  ok: boolean;
  detail: string;
}

export interface EvidenceReport {
  ok: boolean;
  findings: EvidenceFinding[];
}

/** §11 criteria that carry a device-only portion. */
export const DEVICE_CRITERIA = [1, 2, 3, 4, 5, 7] as const;

const SIGN_OFF_ROWS = [
  'Sideload on Device A',
  'Sideload on Device B',
  '72 h crash-free soak (A)',
  '72 h crash-free soak (B)',
  'Tag `v0.1.0` pushed to Gitea',
];

const PLACEHOLDER = /_{2,}/;

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Validate a device-evidence markdown document.
 *
 * @param markdown evidence file contents
 * @param opts.template when true, placeholders are allowed (structure gate)
 */
export function validateDeviceEvidence(
  markdown: string,
  opts: { template?: boolean } = {},
): EvidenceReport {
  const template = opts.template ?? false;
  const findings: EvidenceFinding[] = [];
  const lines = markdown.split('\n');

  // Section 2: accept numbered rows whose first cell is a device criterion.
  const rows = new Map<number, string[]>();
  for (const line of lines) {
    if (!/^\|\s*\d+\s*\|/.test(line.trim())) continue;
    const cells = parseTableRow(line);
    const id = Number(cells[0]);
    if (Number.isInteger(id) && id >= 1 && id <= 7 && !rows.has(id)) rows.set(id, cells);
  }

  for (const id of DEVICE_CRITERIA) {
    const cells = rows.get(id);
    if (!cells) {
      findings.push({ name: `criterion ${id}`, ok: false, detail: 'row missing from evidence table' });
      continue;
    }
    // §11 evidence columns are Device A / Device B (last two cells).
    const deviceA = cells[cells.length - 2] ?? '';
    const deviceB = cells[cells.length - 1] ?? '';
    const filled = (v: string): boolean =>
      v.length > 0 && (template || !PLACEHOLDER.test(v));
    const ok = filled(deviceA) && filled(deviceB);
    findings.push({
      name: `criterion ${id}`,
      ok,
      detail: ok
        ? template
          ? 'evidence columns present'
          : 'device evidence recorded'
        : 'Device A/B evidence missing or still placeholder',
    });
  }

  // Section 4: release sign-off checkboxes.
  for (const row of SIGN_OFF_ROWS) {
    const line = lines.find((l) => l.includes(`| ${row} |`));
    if (!line) {
      findings.push({ name: row, ok: false, detail: 'sign-off row missing' });
      continue;
    }
    const cell = parseTableRow(line).slice(1).join(' ');
    const ok = template ? cell.length > 0 : /\[x\]/i.test(cell);
    findings.push({
      name: row,
      ok,
      detail: ok ? (template ? 'row present' : 'checked') : template ? 'row empty' : 'not checked',
    });
  }

  return { ok: findings.every((f) => f.ok), findings };
}
