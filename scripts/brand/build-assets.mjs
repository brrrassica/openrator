#!/usr/bin/env node
/**
 * OpenRator brand asset pipeline (M6.3).
 *
 * Every raster asset is generated from a committed SVG master. The pipeline is
 * deterministic: same SVG + same font + same resvg version = same PNG bytes.
 * Run `npm run assets:build` from apps/mobile to regenerate, or
 * `npm run assets:check` to fail on drift (CI gate).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BRAND = path.join(ROOT, 'brand');

// The renderer lives in apps/mobile/node_modules; resolve it through the app
// package so the script works when invoked from the repo root or the app.
const requireFromApp = createRequire(path.join(ROOT, 'apps', 'mobile', 'package.json'));
const { Resvg } = requireFromApp('@resvg/resvg-js');

const FONT_FILES = [path.join(BRAND, 'fonts', 'LiberationSans-Bold.ttf')];

/** @type {Array<{src: string, out: string, width: number, height: number}>} */
const JOBS = [
  // Android / Expo app assets
  { src: 'svg/app-icon.svg', out: 'apps/mobile/assets/icon.png', width: 1024, height: 1024 },
  {
    src: 'svg/app-icon-foreground.svg',
    out: 'apps/mobile/assets/android-icon-foreground.png',
    width: 1024,
    height: 1024,
  },
  {
    src: 'svg/app-icon-background.svg',
    out: 'apps/mobile/assets/android-icon-background.png',
    width: 1024,
    height: 1024,
  },
  {
    src: 'svg/app-icon-monochrome.svg',
    out: 'apps/mobile/assets/android-icon-monochrome.png',
    width: 1024,
    height: 1024,
  },
  { src: 'svg/splash-mark.svg', out: 'apps/mobile/assets/splash-icon.png', width: 1024, height: 1024 },
  {
    src: 'svg/splash-screen.svg',
    out: 'apps/mobile/assets/splash-screen.png',
    width: 1200,
    height: 1200,
  },
  { src: 'svg/app-icon.svg', out: 'apps/mobile/assets/favicon.png', width: 48, height: 48 },
  {
    src: 'svg/notification-glyph.svg',
    out: 'apps/mobile/assets/notification-icon.png',
    width: 96,
    height: 96,
  },

  // Documentation / social assets
  { src: 'svg/social-preview.svg', out: 'docs/assets/social-preview.png', width: 1200, height: 630 },
  { src: 'svg/release-banner.svg', out: 'docs/assets/release-banner.png', width: 1600, height: 900 },
  {
    src: 'svg/lockup-horizontal.svg',
    out: 'docs/assets/lockup-horizontal.png',
    width: 1800,
    height: 420,
  },
  {
    src: 'svg/lockup-stacked.svg',
    out: 'docs/assets/lockup-stacked.png',
    width: 1200,
    height: 900,
  },
  { src: 'svg/wordmark.svg', out: 'docs/assets/wordmark.png', width: 1200, height: 300 },
  { src: 'svg/mark-duotone.svg', out: 'docs/assets/mark-512.png', width: 512, height: 512 },
  {
    src: 'svg/mark-monochrome.svg',
    out: 'docs/assets/mark-monochrome-512.png',
    width: 512,
    height: 512,
  },
];

function render(svg, width) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Liberation Sans',
    },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

function pngInfo(buf) {
  const signature = buf.subarray(1, 4).toString('ascii');
  if (signature !== 'PNG') throw new Error('renderer did not return PNG data');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const check = process.argv.includes('--check');
let failures = 0;
let written = 0;
let unchanged = 0;

for (const job of JOBS) {
  const srcPath = path.join(BRAND, job.src);
  const outPath = path.join(ROOT, job.out);
  const svg = readFileSync(srcPath, 'utf8');

  let png;
  try {
    png = render(svg, job.width);
  } catch (err) {
    failures++;
    console.error(`FAIL render ${rel(srcPath)}: ${err.message}`);
    continue;
  }

  const info = pngInfo(png);
  if (info.width !== job.width || info.height !== job.height) {
    failures++;
    console.error(
      `FAIL size ${job.out}: expected ${job.width}x${job.height}, got ${info.width}x${info.height}`,
    );
    continue;
  }

  if (check) {
    if (!existsSync(outPath)) {
      failures++;
      console.error(`MISSING ${job.out}`);
      continue;
    }
    const current = readFileSync(outPath);
    if (sha256(current) !== sha256(png)) {
      failures++;
      console.error(`DRIFT ${job.out} — run npm run assets:build`);
    } else {
      unchanged++;
      console.log(`ok ${job.out}`);
    }
    continue;
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  if (existsSync(outPath) && sha256(readFileSync(outPath)) === sha256(png)) {
    unchanged++;
  } else {
    writeFileSync(outPath, png);
    written++;
  }
  console.log(`${existsSync(outPath) ? 'wrote' : 'wrote'} ${job.out} (${job.width}x${job.height})`);
}

if (check) {
  console.log(`\nasset check: ${unchanged} ok, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
} else {
  console.log(`\nasset build: ${written} written, ${unchanged} unchanged, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}
