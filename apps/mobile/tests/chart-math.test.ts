import { describe, expect, it } from 'vitest';
import {
  arcPath,
  areaPath,
  barScale,
  donutSegments,
  fmtCount,
  fmtUsd,
  limitLabel,
  limitRemainingLabel,
  linePath,
} from '../src/ui/chart-math';

describe('areaPath / linePath', () => {
  it('empty data → empty path', () => {
    expect(areaPath([], 100, 40)).toBe('');
    expect(linePath([], 100, 40)).toBe('');
  });

  it('builds a closed area polygon and an open polyline', () => {
    const area = areaPath([1, 2, 3], 100, 40);
    expect(area.startsWith('M ')).toBe(true);
    expect(area.includes(' Z')).toBe(true);
    const line = linePath([1, 2, 3], 100, 40);
    expect(line.startsWith('M ')).toBe(true);
    expect(line.includes(' L ')).toBe(true);
    expect(line.includes(' Z')).toBe(false);
  });

  it('scales the max value to the top padding', () => {
    const line = linePath([0, 10], 100, 40);
    // max (10) should be near the top (y ≈ pad = 4)
    const points = line.match(/[\d.]+,[\d.]+/g)!.map((p) => p.split(',').map(Number));
    expect(points[0][1]).toBeCloseTo(36, 0); // 0 → bottom
    expect(points[1][1]).toBeCloseTo(4, 0); // 10 → top
  });
});

describe('barScale', () => {
  it('normalizes against max and clamps', () => {
    expect(barScale([1, 2, 4])).toEqual([0.25, 0.5, 1]);
    expect(barScale([10, 0], 5)).toEqual([1, 0]);
  });

  it('all zeros → all zeros (no div by zero)', () => {
    expect(barScale([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('donutSegments', () => {
  it('angles sum to 2π and sort descending', () => {
    const segs = donutSegments([
      { value: 10, color: 'a' },
      { value: 30, color: 'b' },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].color).toBe('b'); // largest first
    expect(segs[1].end).toBeCloseTo(Math.PI * 2, 5);
    expect(segs[0].fraction).toBeCloseTo(0.75);
  });

  it('drops zero/negative slices and total-0 returns []', () => {
    expect(donutSegments([{ value: 0, color: 'x' }])).toEqual([]);
    expect(donutSegments([{ value: -5, color: 'x' }, { value: 5, color: 'y' }])).toHaveLength(1);
  });

  it('single 100% slice spans a full circle', () => {
    const segs = donutSegments([{ value: 10, color: 'a' }]);
    expect(segs).toHaveLength(1);
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBeCloseTo(Math.PI * 2, 6);
  });
});

describe('arcPath', () => {
  it('emits an SVG arc command', () => {
    const d = arcPath(50, 50, 40, 10, 0, Math.PI / 2);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' A 40 40 0 0 1 ');
  });

  it('emits two half arcs for a full circle so the ring is visible', () => {
    const [seg] = donutSegments([{ value: 10, color: 'a' }]);
    const d = arcPath(50, 50, 40, 10, seg.start, seg.end);
    expect(d.match(/ A /g)).toHaveLength(2);
    expect(d.startsWith('M 90.00 50.00 A 40 40 0 0 1 ')).toBe(true);
    expect(d).not.toBe('M 90.00 50.00 A 40 40 0 1 1 90.00 50.00');
  });
});

describe('formatters', () => {
  it('fmtUsd: sub-cent, cents, singles, k, m, negatives', () => {
    expect(fmtUsd(0.0001)).toBe('$0.00');
    expect(fmtUsd(0.02)).toBe('$0.02');
    expect(fmtUsd(1.234)).toBe('$1.23');
    expect(fmtUsd(9.99)).toBe('$9.99');
    expect(fmtUsd(12.3)).toBe('$12.30');
    expect(fmtUsd(1234)).toBe('$1.2k');
    expect(fmtUsd(2_500_000)).toBe('$2.5m');
    expect(fmtUsd(-3.5)).toBe('-$3.50');
    expect(fmtUsd(Number.NaN)).toBe('$0');
  });

  it('fmtCount: plain, k, m', () => {
    expect(fmtCount(42)).toBe('42');
    expect(fmtCount(2500)).toBe('2.5k');
    expect(fmtCount(3_000_000)).toBe('3.0m');
  });

  it('limitLabel: unlimited for zero/non-finite, else remaining/limit', () => {
    expect(limitLabel(3.2, 4)).toBe('3.20 / 4.00');
    expect(limitLabel(2, 0)).toBe('unlimited');
    expect(limitLabel(Number.NaN, 0)).toBe('unlimited');
  });

  it('limitRemainingLabel: no key limit for zero/non-finite, else USD remaining', () => {
    expect(limitRemainingLabel(3.2, 4)).toBe('$3.20 remaining');
    expect(limitRemainingLabel(0, 0)).toBe('No key limit');
    expect(limitRemainingLabel(0, Number.NaN)).toBe('No key limit');
  });
});