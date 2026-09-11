/**
 * The update check, without GitHub: version order, release parsing, and the
 * hold rules — "Later" for a day, "Skip" for a version, a forced check for
 * neither. Run with `npm run test:updates`.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notchlight-updates-'));
try {
  await build({ entryPoints: ['src/main/updates.ts'], bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, outdir: root, logLevel: 'silent' });
  const require = createRequire(import.meta.url);
  const { compareVersions, parseRelease, Updater, LATER_MS } = require(path.join(root, 'updates.cjs'));

  // Order.
  assert.ok(compareVersions('0.2.0', '0.1.0') > 0);
  assert.ok(compareVersions('v0.2.0', '0.2.0') === 0);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('1.0', '1.0.0') === 0);
  assert.ok(compareVersions('0.2.0-beta', '0.2.0') === 0, 'a prerelease suffix is ignored');
  assert.ok(compareVersions('0.1.9', '0.2.0') < 0);

  // Parsing, and the DMG for this machine.
  const release = {
    tag_name: 'v0.3.0', name: 'Notchlight 0.3.0', body: '## Notes\r\n- one\r\n', html_url: 'https://github.com/amargoyal/notchlight/releases/tag/v0.3.0', published_at: '2026-09-11T00:00:00Z',
    assets: [
      { browser_download_url: 'https://github.com/amargoyal/notchlight/releases/download/v0.3.0/manifest.json' },
      { browser_download_url: 'https://github.com/amargoyal/notchlight/releases/download/v0.3.0/Notchlight-0.3.0-x64.dmg' },
      { browser_download_url: 'https://github.com/amargoyal/notchlight/releases/download/v0.3.0/Notchlight-0.3.0-arm64.dmg' }
    ]
  };
  const parsed = parseRelease(release, 'arm64');
  assert.equal(parsed.version, '0.3.0');
  assert.equal(parsed.title, 'Notchlight 0.3.0');
  assert.equal(parsed.notes, '## Notes\n- one');
  assert.ok(parsed.download.endsWith('arm64.dmg'));
  assert.ok(parseRelease(release, 'x64').download.endsWith('x64.dmg'));
  assert.equal(parseRelease({ ...release, assets: [] }).download, release.html_url, 'no DMG: the release page');
  assert.equal(parseRelease({ ...release, name: '' }).title, 'v0.3.0');
  assert.equal(parseRelease({ tag_name: 'nightly' }), null, 'a tag that is not a version is not an update');
  assert.equal(parseRelease(null), null);

  // The hold rules.
  let now = Date.parse('2026-09-11T12:00:00Z');
  const file = path.join(root, 'state', 'updates.json');
  const answers = [];
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => release });
  const make = () => {
    const u = new Updater({ current: '0.2.0', automatic: false, fetchImpl, stateFile: file, now: () => now });
    u.on('update', r => answers.push(r.version));
    return u;
  };
  let u = make();
  assert.equal((await u.check(false)).kind, 'update');
  assert.deepEqual(answers, ['0.3.0']);
  assert.ok(fs.existsSync(file), 'the check is remembered');

  u.later();
  assert.equal((await u.check(false)).kind, 'held', 'Later holds it');
  now += LATER_MS + 1;
  assert.equal((await u.check(false)).kind, 'update', 'a day later it is back');

  u.skip('0.3.0');
  u = make(); // a restart reads the file
  assert.equal((await u.check(false)).kind, 'held', 'skipped survives a restart');
  assert.equal((await u.check(true)).kind, 'update', 'a forced check ignores the skip');
  assert.deepEqual(answers, ['0.3.0', '0.3.0', '0.3.0']);

  // A newer one than the skipped version still shows.
  const newer = { ...release, tag_name: 'v0.4.0' };
  const u2 = new Updater({ current: '0.2.0', automatic: false, fetchImpl: async () => ({ ok: true, status: 200, json: async () => newer }), stateFile: file, now: () => now });
  assert.equal((await u2.check(false)).kind, 'update');

  // Up to date, and failure, never open anything.
  const same = new Updater({ current: '0.3.0', automatic: false, fetchImpl, stateFile: path.join(root, 'same.json'), now: () => now });
  assert.equal((await same.check(false)).kind, 'current');
  const down = new Updater({ current: '0.2.0', automatic: false, fetchImpl: async () => ({ ok: false, status: 503 }), stateFile: path.join(root, 'down.json'), now: () => now });
  const failed = await down.check(true);
  assert.equal(failed.kind, 'failed');
  assert.match(failed.error, /503/);
  const none = new Updater({ current: '0.2.0', automatic: false, fetchImpl: async () => ({ ok: false, status: 404 }), stateFile: path.join(root, 'none.json'), now: () => now });
  assert.equal((await none.check(true)).kind, 'current', 'no release yet is not a failure');

  console.log('updates: ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
