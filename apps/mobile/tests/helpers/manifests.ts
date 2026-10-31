/**
 * Test-only manifest loader. Reads the real app manifests so the acceptance
 * and release gates are validated against what actually ships, never against
 * hardcoded values. Lives in the test tree because `src` must stay free of
 * filesystem access (React Native bundle).
 */

import { readFileSync } from 'node:fs';
import { BuildFacts } from '../../src/qa/acceptance';
import { ReleaseFacts } from '../../src/qa/release';

/** package.json is strict JSON. */
export const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/** app.json may contain `//` comments (Expo accepts JSON5-ish config). */
export const APP_JSON_RAW = readFileSync(new URL('../../app.json', import.meta.url), 'utf8');
export const APP_JSON = JSON.parse(stripJsonComments(APP_JSON_RAW)) as {
  expo: { version: string; android: { versionCode: number; package?: string } };
};

export const EAS_JSON_RAW = readFileSync(new URL('../../eas.json', import.meta.url), 'utf8');
export const EAS_JSON = JSON.parse(stripJsonComments(EAS_JSON_RAW)) as {
  build?: Record<
    string,
    { channel?: string; android?: { buildType?: string; distribution?: string } }
  >;
};

export const CHANGELOG = readFileSync(
  new URL('../../../../docs/CHANGELOG.md', import.meta.url),
  'utf8',
);

export const RELEASE_JSON_RAW = readFileSync(
  new URL('../../../../docs/release.json', import.meta.url),
  'utf8',
);
export const RELEASE_JSON = JSON.parse(RELEASE_JSON_RAW) as {
  status?: 'artifact' | 'source';
  version: string;
  versionCode: number;
  buildId?: string;
  commit?: string;
  sha256?: string;
  tag: string;
  apkUrl?: string;
  bytes?: number;
  releasedAt?: string;
};

/** Build facts consumed by §11 criterion 7. */
export const BUILD_FACTS: BuildFacts = {
  packageVersion: PACKAGE_JSON.version,
  appVersion: APP_JSON.expo.version,
  androidVersionCode: APP_JSON.expo.android.versionCode,
  easProduction: EAS_JSON.build?.production
    ? {
        channel: EAS_JSON.build.production.channel,
        buildType: EAS_JSON.build.production.android?.buildType,
        distribution: EAS_JSON.build.production.android?.distribution,
      }
    : null,
  changelog: CHANGELOG,
  release: {
    status: RELEASE_JSON.status,
    version: RELEASE_JSON.version,
    versionCode: RELEASE_JSON.versionCode,
    buildId: RELEASE_JSON.buildId,
    commit: RELEASE_JSON.commit,
    sha256: RELEASE_JSON.sha256,
  },
};

/** Facts consumed by the M5.6 release-readiness gate. */
export const RELEASE_FACTS: ReleaseFacts = {
  packageVersion: PACKAGE_JSON.version,
  appVersion: APP_JSON.expo.version,
  androidVersionCode: APP_JSON.expo.android.versionCode,
  androidPackage: APP_JSON.expo.android.package,
  eas: EAS_JSON,
  changelog: CHANGELOG,
  release: RELEASE_JSON,
  manifests: [
    { name: 'package.json', raw: readFileSync(new URL('../../package.json', import.meta.url), 'utf8') },
    { name: 'app.json', raw: APP_JSON_RAW },
    { name: 'eas.json', raw: EAS_JSON_RAW },
  ],
};

/**
 * Remove `//` and block comments while preserving string contents, so Expo's
 * JSON5-ish `app.json` can be parsed by `JSON.parse`.
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
