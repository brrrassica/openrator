import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_CONTRAST_NORMAL,
  MIN_TOUCH_TARGET_PX,
  auditThemeContrast,
  contrastRatio,
  extractStyleEntries,
  scanTappableSource,
} from '../src/qa/a11y-audit';
import { DARK_TOKENS, LIGHT_TOKENS } from '../src/ui/theme-tokens';

/** M5.3/M5.4 — accessibility gates: contrast tokens + strict touch targets. */

const UI = path.join(__dirname, '..', 'src', 'ui');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const UI_FILES = walk(UI);

describe('WCAG contrast math', () => {
  it('computes black-on-white at the known 21:1 maximum', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('computes identical colours at 1:1', () => {
    expect(contrastRatio('#0B1220', '#0B1220')).toBeCloseTo(1, 5);
  });

  it('expands 3-digit hex', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
  });

  it('throws on an invalid hex value', () => {
    expect(() => contrastRatio('not-a-colour', '#fff')).toThrow(/invalid hex/);
  });
});

describe('light/dark theme token contrast', () => {
  for (const [mode, tokens] of [
    ['light', LIGHT_TOKENS],
    ['dark', DARK_TOKENS],
  ] as const) {
    it(`${mode} mode meets WCAG AA for every semantic pair`, () => {
      const checks = auditThemeContrast({ mode, ...tokens });
      const failing = checks.filter((c) => !c.ok);
      expect(
        failing,
        failing.map((c) => `${c.foreground} on ${c.background} = ${c.ratio}`).join('; '),
      ).toEqual([]);
      expect(checks.every((c) => c.ratio >= MIN_CONTRAST_NORMAL)).toBe(true);
    });
  }
});

describe('static touch-target scan', () => {
  it('scans the real UI tree', () => {
    expect(UI_FILES.length).toBeGreaterThan(8);
  });

  it('every Pressable/Touchable meets the ≥ 44 px target or opts into hitSlop', () => {
    const findings = UI_FILES.flatMap((file) =>
      scanTappableSource(path.relative(UI, file), fs.readFileSync(file, 'utf8')),
    );
    const failing = findings.filter((f) => f.status !== 'ok');
    expect(
      failing,
      failing.map((f) => `${f.file}:${f.line} <${f.tag}> — ${f.detail}`).join('\n'),
    ).toEqual([]);
    // Guard against the scanner silently matching nothing.
    expect(findings.length).toBeGreaterThan(20);
  });

  it('detects a tappable styled below the minimum', () => {
    const src = `
      const styles = StyleSheet.create({
        tiny: { paddingVertical: 2 },
      });
      export function C() {
        return <Pressable style={styles.tiny} onPress={go} />;
      }`;
    const findings = scanTappableSource('fixture.tsx', src);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe('missing-target');
  });

  it('accepts an explicit minHeight or hitSlop', () => {
    const src = `
      const styles = StyleSheet.create({
        good: { minHeight: ${MIN_TOUCH_TARGET_PX}, justifyContent: 'center' },
      });
      export function C() {
        return (
          <>
            <Pressable style={styles.good} onPress={go} />
            <Pressable hitSlop={12} onPress={go} />
          </>
        );
      }`;
    expect(scanTappableSource('fixture.tsx', src).every((f) => f.status === 'ok')).toBe(true);
  });

  it('flags an unresolved style reference', () => {
    const src = `export const C = () => <Pressable style={styles.nope} onPress={go} />;`;
    const findings = scanTappableSource('fixture.tsx', src);
    expect(findings[0].status).toBe('unresolved-style');
  });

  it('extracts flat StyleSheet entries', () => {
    const entries = extractStyleEntries(
      `StyleSheet.create({ a: { minHeight: 44 }, b: { padding: 4 } })`,
    );
    expect(entries.get('a')).toContain('minHeight: 44');
    expect(entries.has('b')).toBe(true);
  });
});
