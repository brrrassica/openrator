import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Secrets guard (M5.1, spec §10): static scan keeping credentials out of
 * logs and the right side of the wire. Any failure here is a release blocker.
 */

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const ALLOW_RAW_PATTERN = new Set([
  path.join('core', 'credentials.ts'),
  path.join('core', 'client.ts'),
  path.join('ui', 'onboarding.tsx'),
  path.join('ui', 'keys-pane.tsx'), // only the sk-or-v1-… placeholder/doc text
]);

describe('secrets guard (static scan)', () => {
  it('scans a non-empty source tree', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('no console.log/debug/info that could carry a secret', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/console\.(log|debug|info)\(/.test(line)) {
          offenders.push(`${path.relative(f, SRC)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'console.log/debug/info are banned in src — use console.error for user-facing state only').toEqual([]);
  });

  it('no log call (any level) references a secret-bearing identifier', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/console\./.test(line) && /(api_?key|secret|token|authorization|bearer|sk-)/i.test(line)) {
          offenders.push(`${path.relative(f, SRC)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('raw key values never reach the log/DB boundary (no sk-or-v1- literals except allowlist)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const rel = path.relative(f, SRC);
      if (ALLOW_RAW_PATTERN.has(rel)) continue;
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/sk-or-v1-[A-Za-z0-9_-]{6,}/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('settings writes never persist raw key material (one-way hashes allowed)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('setSetting(')) return;
        if (/\{\s*$/.test(line.trim()) && !/await|;/.test(line)) return; // function def, not a call
        const body = line.slice(line.indexOf('setSetting(') + 'setSetting('.length);
        const value = body.split(')')[0].split(',').slice(2).join(',');
        const isKeyLike = /\b(key|secret|token|bearer|api_key)\b/i.test(value);
        const isSafeTransform = /\b(shortHash|hash|prefix|label)\b/.test(value);
        if (isKeyLike && !isSafeTransform) {
          offenders.push(`${path.relative(f, SRC)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('network targets are whitelisted (openrouter.ai only in static URLs)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const urls = [...line.matchAll(/https?:\/\/[^'"\s]+/g)].map((m) => m[0]);
        for (const u of urls) {
          if (!u.startsWith('https://openrouter.ai') && !u.startsWith('https://stats.openrouter.ai')) {
            offenders.push(`${path.relative(f, SRC)}:${i + 1} ${u}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});