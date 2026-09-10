import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notchlight-liveness-'));
const originalCwd = process.cwd();
try {
  await build({ entryPoints: ['src/main/liveness.ts', 'src/main/store.ts'], bundle: true,
    platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, outdir: root });
  const require = createRequire(import.meta.url);
  const { Liveness } = require(path.join(root, 'liveness.cjs'));
  const { Store } = require(path.join(root, 'store.cjs'));
  const old = path.join(root, 'old-project');
  const renamed = path.join(root, 'renamed-project');
  fs.mkdirSync(old);
  process.chdir(old);
  fs.renameSync(old, renamed);
  fs.symlinkSync(renamed, old, 'dir');

  // The process remains in the renamed directory; cached transcripts use old.
  const live = new Liveness();
  live.readCwds([String(process.pid)]);
  const deadline = Date.now() + 5000;
  while (!live.reliable() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  assert.ok(live.reliable(), 'lsof must return this process directory');
  assert.equal(live.countFor(renamed), 1);
  assert.equal(live.countFor(old), 1, 'cached transcript path must match renamed process cwd');
  assert.equal(live.countFor(path.join(root, 'unrelated')), 0);

  const store = new Store();
  store.liveness = live;
  const now = Date.now();
  const facts = (sessionId, cwd, lastAt) => ({ sessionId, cwd, file: '', project: 'fixture', title: '',
    startedAt: now - 1000, lastAt, mainLastAt: lastAt, tokens: 0, agents: [], busy: false, tail: [] });
  for (const f of [facts('cached-session', old, now), facts('older-session', renamed, now - 100)]) {
    store.facts.set(f.sessionId, f);
    store.ensure(f.sessionId, f.cwd).deadSince = now - 60_000;
  }
  store.sweepClosed();
  assert.ok(!store.closed.has('cached-session'), 'renamed session stays visible after grace period');
  assert.ok(store.closed.has('older-session'), 'aliases share one process budget, not one per spelling');
  assert.deepEqual(store.snapshot().sessions.map(s => s.id), ['cached-session']);

  live.counts.clear();
  // A different live process prevents the existing fail-open fallback for zero processes.
  live.counts.set(path.join(root, 'another-project'), 1);
  store.live.get('cached-session').deadSince = now - 60_000;
  store.sweepClosed();
  assert.ok(store.closed.has('cached-session'), 'a truly closed session is still removed');
  console.log('Liveness checks passed: renamed cwd, cached alias, shared process budget, snapshot visibility, closed-session removal.');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
}
