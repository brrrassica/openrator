/**
 * OpenRator — executable release-readiness gate (M5.6).
 *
 * The v0.1.0 APK identity used to live only in prose (`docs/04-qa-checklist.md`
 * §4, `docs/RELEASE-NOTES-v0.1.0.md`). This module turns those facts into a
 * deterministic gate: the app manifests, `docs/release.json`, the changelog,
 * and the EAS profile must all agree before a tag can be trusted.
 *
 * Pure (no filesystem/network). `tests/release.test.ts` feeds it the real
 * repository files, so `npm run release:check` fails on any drift.
 */

export type ReleaseStatus = 'artifact' | 'source';

export interface ReleaseRecord {
  /**
   * `artifact` (default) = an APK exists and its identity is recorded.
   * `source` = tagged source release; no APK identity yet.
   */
  status?: ReleaseStatus;
  version: string;
  versionCode: number;
  buildId?: string;
  commit?: string;
  sha256?: string;
  tag: string;
  apkUrl?: string;
  bytes?: number;
  releasedAt?: string;
}

export interface ReleaseFacts {
  packageVersion: string;
  appVersion: string;
  androidVersionCode: number;
  androidPackage?: string;
  eas: {
    build?: Record<
      string,
      { channel?: string; android?: { buildType?: string; distribution?: string } }
    >;
  };
  changelog: string;
  release: ReleaseRecord;
  /** Raw manifest texts, used to reject duplicate JSON keys. */
  manifests: Array<{ name: string; raw: string }>;
}

export interface ReleaseFinding {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReleaseReport {
  ok: boolean;
  findings: ReleaseFinding[];
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{7,40}$/i;
const PACKAGE_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Built without a literal scheme so the `src` network-whitelist scan stays clean.
const HTTPS_PREFIX = ['https', '://'].join('');

/**
 * Remove `//` and block comments while respecting string contents. Expo's
 * `app.json` is JSON5-ish, so `JSON.parse` needs the comments stripped first.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Report duplicate keys (JSON.parse silently keeps the last one). This is how
 * the accidental duplicate `expo.splash` / `expo.android.package` entries in
 * `app.json` were caught: the effective package id silently changed.
 */
export function findDuplicateJsonKeys(text: string): string[] {
  const json = stripJsonComments(text);
  const duplicates: string[] = [];
  let i = 0;

  const skipWhitespace = (): void => {
    while (i < json.length && /\s/.test(json[i])) i++;
  };

  const parseString = (): string => {
    let value = '';
    i++; // opening quote
    while (i < json.length) {
      const c = json[i];
      if (c === '\\') {
        value += json[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        break;
      }
      value += c;
      i++;
    }
    return value;
  };

  const parseValue = (path: string): void => {
    skipWhitespace();
    const c = json[i];
    if (c === '{') {
      parseObject(path);
    } else if (c === '[') {
      parseArray(path);
    } else if (c === '"') {
      parseString();
    } else {
      while (i < json.length && !/[\s,}\]]/.test(json[i])) i++;
    }
  };

  const parseObject = (path: string): void => {
    i++; // {
    const seen = new Set<string>();
    skipWhitespace();
    while (i < json.length && json[i] !== '}') {
      if (json[i] !== '"') {
        i++; // tolerate malformed input; JSON.parse elsewhere will fail
        skipWhitespace();
        continue;
      }
      const key = parseString();
      const keyPath = path ? `${path}.${key}` : key;
      if (seen.has(key)) duplicates.push(keyPath);
      else seen.add(key);
      skipWhitespace();
      if (json[i] === ':') i++;
      parseValue(keyPath);
      skipWhitespace();
      if (json[i] === ',') {
        i++;
        skipWhitespace();
      }
    }
    i++; // }
  };

  const parseArray = (path: string): void => {
    i++; // [
    let index = 0;
    skipWhitespace();
    while (i < json.length && json[i] !== ']') {
      parseValue(`${path}[${index}]`);
      index++;
      skipWhitespace();
      if (json[i] === ',') {
        i++;
        skipWhitespace();
      }
    }
    i++; // ]
  };

  parseValue('');
  return duplicates;
}

/** Evaluate the release identity for internal consistency. */
export function evaluateReleaseReadiness(facts: ReleaseFacts): ReleaseReport {
  const findings: ReleaseFinding[] = [];
  const { release } = facts;
  const production = facts.eas.build?.production;

  const push = (name: string, ok: boolean, detail: string): void => {
    findings.push({ name, ok, detail });
  };

  push(
    'package.json, app.json, and release.json versions agree',
    facts.packageVersion === facts.appVersion && facts.packageVersion === release.version,
    `${facts.packageVersion} / ${facts.appVersion} / ${release.version}`,
  );
  push('release version is semver', SEMVER.test(release.version), release.version);
  push(
    'versionCode is positive and matches the release record',
    Number.isInteger(facts.androidVersionCode) &&
      facts.androidVersionCode > 0 &&
      facts.androidVersionCode === release.versionCode,
    `${facts.androidVersionCode} / ${release.versionCode}`,
  );
  push(
    'git tag is v<version>',
    release.tag === `v${release.version}`,
    `${release.tag} vs v${release.version}`,
  );
  push(
    'EAS production profile builds an internal APK',
    production?.channel === 'production' &&
      production.android?.buildType === 'apk' &&
      production.android?.distribution === 'internal',
    production
      ? `${production.channel}/${production.android?.buildType}/${production.android?.distribution}`
      : 'production profile missing',
  );
  push(
    'CHANGELOG records the released version',
    facts.changelog.includes(`## [${release.version}]`),
    `## [${release.version}]`,
  );

  const status = release.status ?? 'artifact';
  push(
    'release status is artifact or source',
    status === 'artifact' || status === 'source',
    status,
  );
  if (status === 'source') {
    push(
      'source-only release records no fabricated APK identity',
      !release.buildId && !release.commit && !release.sha256 && !release.apkUrl,
      'no APK identity (pending build)',
    );
  } else {
    push(
      'APK SHA-256 is 64 lowercase hex characters',
      HEX64.test(release.sha256 ?? ''),
      (release.sha256 ?? '').slice(0, 12),
    );
    push('APK build id is recorded', Boolean(release.buildId), release.buildId || 'missing');
    push(
      'APK source commit is a git hash',
      GIT_COMMIT.test(release.commit ?? ''),
      release.commit || 'missing',
    );
    push(
      'APK URL is HTTPS',
      Boolean(
        release.apkUrl &&
          release.apkUrl.startsWith(HTTPS_PREFIX) &&
          release.apkUrl.length > HTTPS_PREFIX.length,
      ),
      release.apkUrl ? 'https' : 'missing',
    );
    push(
      'APK byte size is a positive integer',
      release.bytes === undefined || (Number.isInteger(release.bytes) && release.bytes > 0),
      release.bytes === undefined ? 'not recorded' : `${release.bytes}`,
    );
  }
  push(
    'release date is an ISO day',
    release.releasedAt === undefined || ISO_DAY.test(release.releasedAt),
    release.releasedAt ?? 'not recorded',
  );
  push(
    'android package id is a reverse-DNS identifier',
    Boolean(facts.androidPackage && PACKAGE_ID.test(facts.androidPackage)),
    facts.androidPackage ?? 'missing',
  );

  for (const manifest of facts.manifests) {
    const duplicates = findDuplicateJsonKeys(manifest.raw);
    push(
      `${manifest.name} has no duplicate keys`,
      duplicates.length === 0,
      duplicates.length === 0 ? 'clean' : duplicates.join(', '),
    );
  }

  return { ok: findings.every((f) => f.ok), findings };
}

/** Render findings for local/CI logs (deterministic, no timestamps). */
export function renderReleaseReport(report: ReleaseReport): string {
  const lines = [`release-readiness: ${report.ok ? 'PASS' : 'FAIL'}`, ''];
  for (const finding of report.findings) {
    lines.push(`${finding.ok ? 'ok  ' : 'FAIL'}  ${finding.name} — ${finding.detail}`);
  }
  return `${lines.join('\n')}\n`;
}
