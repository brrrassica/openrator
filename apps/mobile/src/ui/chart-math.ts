/**
 * OpenRator — pure chart math (M2.1). No RN imports → unit-testable.
 * Light-weight custom SVG: polyline area chart, horizontal bars, donut.
 */

export interface Point {
  x: number;
  y: number;
}

/** Simple polyline area path with baseline close. */
export function areaPath(
  data: number[],
  width: number,
  height: number,
  pad = 4,
): string {
  if (data.length === 0) return '';
  const max = Math.max(...data, 0);
  const n = data.length;
  const dx = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const yFor = (v: number): number => height - pad - (max === 0 ? 0 : (v / max) * (height - pad * 2));
  const pts: string[] = [];
  data.forEach((v, i) => {
    pts.push(`${(pad + i * dx).toFixed(2)},${yFor(v).toFixed(2)}`);
  });
  const top = pts.join(' L ');
  return `M ${top} L ${(width - pad).toFixed(2)},${(height - pad).toFixed(2)} L ${pad.toFixed(2)},${height - pad} Z`;
}

/** Stroke-only line path for the same series. */
export function linePath(data: number[], width: number, height: number, pad = 4): string {
  if (data.length === 0) return '';
  const max = Math.max(...data, 0);
  const n = data.length;
  const dx = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const yFor = (v: number): number => height - pad - (max === 0 ? 0 : (v / max) * (height - pad * 2));
  return data
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(pad + i * dx).toFixed(2)},${yFor(v).toFixed(2)}`)
    .join(' ');
}

/** Horizontal bar segments: returns fill fractions (0..1) + values. */
export function barScale(values: number[], maxValue?: number): number[] {
  const max = maxValue ?? Math.max(...values, 0);
  return values.map((v) => (max === 0 ? 0 : Math.max(0, Math.min(1, v / max))));
}

export interface DonutSlice {
  value: number;
  color: string;
}

/** Donut arc segments (0..2π each), from largest to smallest. */
export function donutSegments(
  slices: { value: number; color: string }[],
): Array<{ start: number; end: number; color: string; fraction: number }> {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total === 0) return [];
  let acc = 0;
  return slices
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((s) => {
      const start = acc;
      acc += (s.value / total) * Math.PI * 2;
      return { start, end: acc, color: s.color, fraction: s.value / total };
    });
}

export function arcPath(
  cx: number,
  cy: number,
  r: number,
  stroke: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** USD formatting: $0.02, $1.23, $12.30, $1.2k, $1.5m. */
export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  if (v < 0) return `-${fmtUsd(-v)}`;
  if (v < 0.005) return '$0.00';
  if (v < 1000) return `$${v.toFixed(2)}`;
  if (v < 1_000_000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${(v / 1_000_000).toFixed(1)}m`;
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Short "x/y remaining" ratio label, e.g. 3.20 / 4.00. */
export function limitLabel(remaining: number, limit: number): string {
  if (!Number.isFinite(limit) || limit === 0) return 'unlimited';
  return `${remaining.toFixed(2)} / ${limit.toFixed(2)}`;
}