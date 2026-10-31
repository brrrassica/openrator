#!/usr/bin/env node
/**
 * Regenerates the SVG masters from the approved traced mark.
 *
 * Source of truth: brand/generated/mark-trace.svg (traced from the approved
 * raster crop docs/assets/brand/source-mark-bw.png). Keeping this script means
 * the mark can never drift between the icon, splash, notification glyph,
 * lockups, and social preview.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SVG_DIR = path.join(ROOT, 'brand', 'svg');
const TRACE = path.join(ROOT, 'brand', 'generated', 'mark-trace.svg');

const trace = readFileSync(TRACE, 'utf8');
const dm = trace.match(/\sd="([^"]+)"/);
if (!dm) throw new Error('could not find a path in brand/generated/mark-trace.svg');
const D = dm[1];

const svg = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img">\n${body}\n</svg>\n`;

const appMark = `/**
 * OpenRator brand mark — GENERATED from brand/generated/mark-trace.svg.
 * Do not edit by hand; run \`node scripts/brand/make-masters.mjs\`.
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';

export const MARK_PATH = '${D}';

export function BrandMark({
  size = 24,
  color = '#0A74D8',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      accessibilityRole="image"
      accessibilityLabel="OpenRator"
    >
      <Path d={MARK_PATH} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
`;

const markPath = (fill, extra = '') =>
  `  <path d="${D}" fill="${fill}" fill-rule="evenodd"${extra}/>`;

const files = {
  'mark-solid.svg': svg('0 0 512 512', markPath('currentColor') + '\n'),

  'mark-duotone.svg': svg(
    '0 0 512 512',
    `  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#23C6F4"/>
      <stop offset="1" stop-color="#0A74D8"/>
    </linearGradient>
  </defs>
${markPath('url(#brand)')}
`,
  ),

  'mark-monochrome.svg': svg('0 0 512 512', markPath('currentColor') + '\n'),

  'app-icon.svg': svg(
    '0 0 1024 1024',
    `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#23C6F4"/>
      <stop offset="1" stop-color="#0A74D8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.16" r="0.85">
      <stop offset="0" stop-color="#BDF3FF" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#BDF3FF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <g transform="translate(-131.4 -129.0) scale(2.47)">
    <path d="${D}" fill="#FFFFFF" fill-rule="evenodd"/>
  </g>
`,
  ),

  'app-icon-foreground.svg': svg(
    '0 0 1024 1024',
    `  <g transform="translate(-91.6 -89.3) scale(2.317)">
    <path d="${D}" fill="#FFFFFF" fill-rule="evenodd"/>
  </g>
`,
  ),

  'app-icon-background.svg': svg(
    '0 0 1024 1024',
    `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#23C6F4"/>
      <stop offset="1" stop-color="#0A74D8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.24" cy="0.14" r="0.9">
      <stop offset="0" stop-color="#C6F6FF" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#C6F6FF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
`,
  ),

  'app-icon-monochrome.svg': svg(
    '0 0 1024 1024',
    `  <g transform="translate(-91.6 -89.3) scale(2.317)">
    <path d="${D}" fill="#000000" fill-rule="evenodd"/>
  </g>
`,
  ),

  'splash-mark.svg': svg(
    '0 0 1024 1024',
    `  <g transform="translate(-192.1 -189.5) scale(2.703)">
    <path d="${D}" fill="#FFFFFF" fill-rule="evenodd"/>
  </g>
`,
  ),

  'notification-glyph.svg': svg('0 0 512 512', markPath('#FFFFFF') + '\n'),

  'lockup-horizontal.svg': svg(
    '0 0 1800 420',
    `  <g transform="translate(-133.7 -122.5) scale(1.281)">
    <path d="${D}" fill="currentColor" fill-rule="evenodd"/>
  </g>
  <text x="430" y="270" fill="currentColor" font-family="Liberation Sans" font-size="220" font-weight="700" letter-spacing="-3">OpenRator</text>
  <text x="436" y="356" fill="currentColor" opacity="0.68" font-family="Liberation Sans" font-size="60" font-weight="700" letter-spacing="1">One pane for every AI bill</text>
`,
  ),

  'lockup-stacked.svg': svg(
    '0 0 1200 900',
    `  <g transform="translate(240.8 -127.9) scale(1.379)">
    <path d="${D}" fill="currentColor" fill-rule="evenodd"/>
  </g>
  <text x="600" y="560" text-anchor="middle" fill="currentColor" font-family="Liberation Sans" font-size="200" font-weight="700" letter-spacing="-3">OpenRator</text>
  <text x="600" y="648" text-anchor="middle" fill="currentColor" opacity="0.68" font-family="Liberation Sans" font-size="54" font-weight="700" letter-spacing="1">One pane for every AI bill</text>
`,
  ),

  'release-banner.svg': svg(
    '0 0 1600 900',
    `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1220"/>
      <stop offset="1" stop-color="#15263F"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.34" r="0.6">
      <stop offset="0" stop-color="#0FB5EF" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#0FB5EF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect width="1600" height="900" fill="url(#glow)"/>
  <g transform="translate(253 -185) scale(2.1)">
    <path d="${D}" fill="#FFFFFF" fill-rule="evenodd"/>
  </g>
  <text x="800" y="735" text-anchor="middle" fill="#FFFFFF" font-family="Liberation Sans" font-size="150" font-weight="700" letter-spacing="-2">OpenRator</text>
  <text x="800" y="808" text-anchor="middle" fill="#9FD9F2" font-family="Liberation Sans" font-size="44" font-weight="700" letter-spacing="1">One pane for every AI bill</text>
  <text x="1540" y="70" text-anchor="end" fill="#5F728A" font-family="Liberation Sans" font-size="26" font-weight="700" letter-spacing="2">v0.2.0</text>
`,
  ),

  'social-preview.svg': svg(
    '0 0 1200 630',
    `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1220"/>
      <stop offset="1" stop-color="#13233B"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.18" cy="0.3" r="0.7">
      <stop offset="0" stop-color="#0FB5EF" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#0FB5EF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(-63.7 -17.5) scale(1.281)">
    <path d="${D}" fill="#FFFFFF" fill-rule="evenodd"/>
  </g>
  <text x="520" y="306" fill="#FFFFFF" font-family="Liberation Sans" font-size="120" font-weight="700" letter-spacing="-2">OpenRator</text>
  <text x="524" y="372" fill="#9FD9F2" font-family="Liberation Sans" font-size="40" font-weight="700" letter-spacing="0.5">One pane for every AI bill</text>
  <text x="524" y="470" fill="#9AA3B2" font-family="Liberation Sans" font-size="26" font-weight="700" letter-spacing="0.5">OpenRouter + OpenCode Zen</text>
`,
  ),

  // Explorations are intentionally not regenerated.
};

for (const [name, content] of Object.entries(files)) {
  writeFileSync(path.join(SVG_DIR, name), content);
  console.log(`wrote brand/svg/${name}`);
}

const appMarkPath = path.join(ROOT, 'apps', 'mobile', 'src', 'ui', 'brand-mark.tsx');
writeFileSync(appMarkPath, appMark);
console.log('wrote apps/mobile/src/ui/brand-mark.tsx');

console.log(`\n${Object.keys(files).length} masters regenerated from the approved trace`);
