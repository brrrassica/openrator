import { describe, expect, it } from 'vitest';
import {
  ReleaseFacts,
  evaluateReleaseReadiness,
  findDuplicateJsonKeys,
  renderReleaseReport,
} from '../src/qa/release';
import { RELEASE_FACTS } from './helpers/manifests';

/**
 * M5.6 — executable release-readiness gate.
 *
 * Reads the real package.json / app.json / eas.json / CHANGELOG / release.json
 * from the repository. `npm run release:check` runs this file in CI so a
 * version bump, tag, or APK checksum that disagrees with the manifests cannot
 * ship silently. Each failure mode below also proves the gate is not a no-op.
 */

const facts = (overrides: Partial<ReleaseFacts> = {}): ReleaseFacts => ({
  ...RELEASE_FACTS,
  ...overrides,
});

describe('release readiness (real repository state)', () => {
  const report = evaluateReleaseReadiness(RELEASE_FACTS);

  it('passes on the committed v0.2.1 source release', () => {
    const failed = report.findings.filter((f) => !f.ok);
    expect(failed, failed.map((f) => `${f.name} (${f.detail})`).join('; ')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('real manifests contain no duplicate JSON keys', () => {
    for (const manifest of RELEASE_FACTS.manifests) {
      expect(findDuplicateJsonKeys(manifest.raw), manifest.name).toEqual([]);
    }
  });

  it('renders a deterministic PASS report', () => {
    expect(renderReleaseReport(report)).toContain('release-readiness: PASS');
  });
});

describe('release readiness fails closed', () => {
  const failedNames = (overrides: Partial<ReleaseFacts>): string[] =>
    evaluateReleaseReadiness(facts(overrides))
      .findings.filter((f) => !f.ok)
      .map((f) => f.name);

  it('fails when app.json drifts from package.json', () => {
    expect(failedNames({ appVersion: '9.9.9' })).toContain(
      'package.json, app.json, and release.json versions agree',
    );
  });

  it('fails when versionCode changes without a release record update', () => {
    expect(failedNames({ androidVersionCode: 2 })).toContain(
      'versionCode is positive and matches the release record',
    );
  });

  it('fails when the tag is not v<version>', () => {
    expect(
      failedNames({ release: { ...RELEASE_FACTS.release, tag: 'release-0.2.0' } }),
    ).toContain('git tag is v<version>');
  });

  it('fails when a source release fabricates an APK identity', () => {
    expect(
      failedNames({
        release: {
          ...RELEASE_FACTS.release,
          status: 'source',
          buildId: 'abc',
          commit: '805ac83',
          sha256: '0048671caed2ca7cd69dc8ba7d41080c6a8e41864214ca68f1d7186b41f3500b',
          apkUrl: 'https://example.com/app.apk',
        },
      }),
    ).toContain('source-only release records no fabricated APK identity');
  });

  it('fails when the EAS production profile is not an internal APK', () => {
    expect(
      failedNames({
        eas: { build: { production: { channel: 'production', android: { buildType: 'aab', distribution: 'store' } } } },
      }),
    ).toContain('EAS production profile builds an internal APK');
  });

  it('fails when the changelog entry is missing', () => {
    expect(failedNames({ changelog: '# Changelog\n' })).toContain(
      'CHANGELOG records the released version',
    );
  });

  it('fails when an artifact release has a malformed checksum', () => {
    expect(
      failedNames({ release: { ...RELEASE_FACTS.release, status: 'artifact', sha256: 'ABC' } }),
    ).toContain('APK SHA-256 is 64 lowercase hex characters');
  });

  it('fails when an artifact release has no commit or build id', () => {
    const names = failedNames({
      release: { ...RELEASE_FACTS.release, status: 'artifact', commit: '', buildId: '' },
    });
    expect(names).toContain('APK build id is recorded');
    expect(names).toContain('APK source commit is a git hash');
  });

  it('fails when an artifact release APK URL is not HTTPS', () => {
    expect(
      failedNames({
        release: {
          ...RELEASE_FACTS.release,
          status: 'artifact',
          apkUrl: 'http://example.com/app.apk',
        },
      }),
    ).toContain('APK URL is HTTPS');
  });

  it('fails an unknown release status', () => {
    expect(
      failedNames({
        release: { ...RELEASE_FACTS.release, status: 'draft' as unknown as 'source' },
      }),
    ).toContain('release status is artifact or source');
  });

  it('fails when the android package id is not reverse-DNS', () => {
    expect(failedNames({ androidPackage: 'openrator' })).toContain(
      'android package id is a reverse-DNS identifier',
    );
  });

  it('fails when a manifest has duplicate keys', () => {
    const names = failedNames({
      manifests: [
        { name: 'app.json', raw: '{"expo":{"android":{"package":"a.b","package":"c.d"}}}' },
      ],
    });
    expect(names).toContain('app.json has no duplicate keys');
  });
});

describe('duplicate JSON key scanner', () => {
  it('finds duplicates at nested paths and ignores string contents', () => {
    const raw = [
      '{',
      '  "a": { "x": 1, "x": 2 },',
      '  "b": [ { "y": 1, "y": 2 } ],',
      '  "s": "// not a comment",',
      '  "t": "quote \\" and slash //",',
      '  "a": { "z": 3 }',
      '}',
    ].join('\n');
    expect(findDuplicateJsonKeys(raw).sort()).toEqual(['a', 'a.x', 'b[0].y']);
  });

  it('tolerates comments and returns nothing for clean JSON', () => {
    const raw = '{\n // note\n "expo": { "version": "0.1.0" }\n}';
    expect(findDuplicateJsonKeys(raw)).toEqual([]);
  });
});
