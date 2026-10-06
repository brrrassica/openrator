/**
 * OpenRator — tiny SVG chart primitives (M2.1) on react-native-svg.
 * No heavy chart libs; math lives in chart-math.ts (pure).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { arcPath, areaPath, donutSegments, linePath } from './chart-math';
import { useTheme } from './theme';

/** 14-day spend area chart (spec §8.1). */
export function AreaChart({
  data,
  width,
  height,
  color,
}: {
  data: number[];
  width: number;
  height: number;
  color?: string;
}) {
  const t = useTheme();
  const fill = color ?? t.accent;
  if (data.length === 0) return <View style={{ width, height }} />;
  return (
    <Svg width={width} height={height}>
      <Path d={areaPath(data, width, height)} fill={fill} opacity={0.14} />
      <Path
        d={linePath(data, width, height)}
        stroke={fill}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Horizontal bar list for top endpoints (spec §8.1). */
export function BarRows({
  rows,
  max,
}: {
  rows: Array<{ label: string; value: number; color?: string; right?: string }>;
  max?: number;
}) {
  const t = useTheme();
  const peak = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={{ marginVertical: 3 }}>
          <View style={styles.barHeader}>
            <Text
              style={[styles.barLabel, { color: t.subtext }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {r.label}
            </Text>
            {r.right ? (
              <Text style={[styles.barRight, { color: t.text }]}>{r.right}</Text>
            ) : null}
          </View>
          <View style={[styles.track, { backgroundColor: t.border }]}>
            <View
              style={{
                width: `${peak === 0 ? 0 : Math.max(2, (r.value / peak) * 100)}%`,
                ...styles.fill,
                backgroundColor: r.color ?? t.accent,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Donut for provider/market share; center label is an RN overlay (crisper). */
export function Donut({
  slices,
  size,
  strokeWidth,
  center,
}: {
  slices: Array<{ value: number; color: string }>;
  size: number;
  strokeWidth: number;
  center?: string;
}) {
  const t = useTheme();
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  if (slices.length === 0) return <View style={{ width: size, height: size }} />;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {donutSegments(slices).map((s, i) => (
          <Path
            key={i}
            d={arcPath(cx, cy, r, strokeWidth, s.start, s.end)}
            stroke={s.color}
            strokeWidth={strokeWidth}
            fill="none"
          />
        ))}
      </Svg>
      {center ? (
        <View style={styles.donutCenter} pointerEvents="none">
          <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>{center}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  barLabel: { flex: 1, paddingRight: 8, fontSize: 11 },
  barRight: { fontSize: 11, fontWeight: '600' },
  donutCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});