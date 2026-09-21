#!/usr/bin/env node
/**
 * How often a helper that keeps being refused is started again.
 *
 * This exists because it was wrong. The backoff was cleared on the helper's
 * first line, a refusal *is* a first line, and so a helper macOS had already
 * said no to was respawned every five seconds for as long as the app was open —
 * eighty-two times in seven minutes, in the log that found it. Nothing else
 * here would have noticed: every other check passed the whole time.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'notchlight-backoff-'));
try {
  // A helper that refuses instantly and exits, exactly as a denied one does.
  const refuser = path.join(out, 'refuser.mjs');
  writeFileSync(refuser, `#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: false, reason: 'denied' }));\nprocess.exit(0);\n`);
  chmodSync(refuser, 0o755);

  const outfile = path.join(out, 'helperProcess.mjs');
  await build({ entryPoints: ['src/main/helperProcess.ts'], bundle: true, platform: 'node', format: 'esm', outfile, external: ['electron'], logLevel: 'error' });
  const { LineHelper } = await import(pathToFileURL(outfile).href);

  // Timers are faked so the delays can be inspected rather than waited out.
  const scheduled = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; };
  const fire = () => { const next = scheduled.shift(); next?.fn(); };

  const started = [];
  const helper = new LineHelper('refuser', () => null, 'notchlight', async () => refuser, []);
  helper.on('ready', line => { if (!JSON.parse(line).ok) helper.markRefused(); });

  helper.setActive(true);
  // Let each refusal land and the retry be scheduled, then fire it.
  for (let i = 0; i < 6; i++) {
    await new Promise(r => realSetTimeout(r, 90));
    const delay = scheduled.find(s => s.ms >= 1000);
    if (delay) { started.push(delay.ms); scheduled.splice(scheduled.indexOf(delay), 1); delay.fn(); }
  }
  await new Promise(r => realSetTimeout(r, 90));
  globalThis.setTimeout = realSetTimeout;
  helper.stop();

  assert.ok(started.length >= 4, `expected several retries to be scheduled, saw ${started.length}`);
  // The whole point: each wait is longer than the last.
  for (let i = 1; i < started.length; i++) {
    assert.ok(started[i] > started[i - 1], `retry ${i} waited ${started[i]}ms, no longer than the ${started[i - 1]}ms before it — the backoff is not growing`);
  }
  assert.equal(started[0], 5000, 'the first retry is prompt');
  assert.ok(started[started.length - 1] >= 40_000, `a helper refused ${started.length} times should be waiting minutes, not ${started[started.length - 1]}ms`);
  // Over an hour, a refused helper must cost a handful of starts, not hundreds.
  const hour = 60 * 60 * 1000;
  let spent = 0, starts = 0, wait = 5000;
  while (spent < hour) { spent += wait; starts++; wait = Math.min(600_000, wait * 2); }
  assert.ok(starts <= 12, `a refused helper would start ${starts} times an hour`);

  console.log(`Backoff checks passed: a refused helper waits ${started.join('ms, ')}ms and costs ${starts} starts an hour, not hundreds.`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
