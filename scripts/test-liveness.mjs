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
  // Counts are keyed by the resolved directory, so fixtures must be too.
  const dir = fs.realpathSync.native(renamed);

  // The process remains in the renamed directory; cached transcripts use old.
  const live = new Liveness();
  live.readCwds([String(process.pid)]);
  const deadline = Date.now() + 5000;
  while (!live.reliable() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  assert.ok(live.reliable(), 'lsof must return this process directory');
  assert.equal(live.countFor(renamed), 1);
  assert.equal(live.countFor(old), 1, 'cached transcript path must match renamed process cwd');
  assert.equal(live.countFor(path.join(root, 'unrelated')), 0);
  live.names.set(String(process.pid), 'claude');
  live.readCwds([String(process.pid)]);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(live.pidsFor(old, 'claude'), [process.pid], 'the process in a directory can be found by pid for jumping back');
  assert.deepEqual(live.pidsFor(old, 'codex'), [], 'names are kept apart');

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
  store.onHook({ event: 'UserPromptSubmit', sessionId: 'cached-session', cwd: old, pid: 4242 });
  store.closed.delete('cached-session');
  assert.equal(store.snapshot().sessions.find(s => s.id === 'cached-session')?.pid, 4242, 'a hook names the session process for Jump to terminal');
  assert.deepEqual(store.processesIn(old), [process.pid]);

  // Closing the only session you had open. The process table goes empty while
  // the transcript is still seconds old, which used to read as a blind probe
  // and left the light burning for a minute and more.
  const solo = new Store();
  solo.liveness = live;
  live.counts.clear();
  live.counts.set(dir, 1);
  const soloFacts = facts('solo-session', renamed, Date.now());
  solo.facts.set(soloFacts.sessionId, soloFacts);
  solo.ensure(soloFacts.sessionId, renamed).deadSince = Date.now() - 60_000;
  solo.sweepClosed();
  assert.ok(!solo.closed.has('solo-session'), 'a session with its process still there stays');
  live.counts.clear();
  assert.ok(live.sawAgents(), 'the probe has resolved a claude process during this run');
  solo.live.get('solo-session').deadSince = Date.now() - 60_000;
  solo.sweepClosed();
  assert.ok(solo.closed.has('solo-session'), 'the last session closing is zero processes, not a blind probe');
  assert.deepEqual(solo.snapshot().sessions.map(s => s.id), []);

  // The same moment on a machine where `claude` never appears in the process
  // table at all. Nothing has ever been resolved, so nothing is hidden.
  const blind = new Store();
  blind.liveness = new Liveness();
  blind.liveness.known = true;
  const blindFacts = facts('blind-session', renamed, Date.now());
  blind.facts.set(blindFacts.sessionId, blindFacts);
  blind.ensure(blindFacts.sessionId, renamed).deadSince = Date.now() - 60_000;
  blind.sweepClosed();
  assert.ok(!blind.closed.has('blind-session'), 'a probe that has never seen claude hides nothing');

  // Identity beats the count: a pid a scan has confirmed, then lost, is gone
  // immediately — no grace period, and no waiting for a sibling to move.
  const named = new Store();
  named.liveness = live;
  live.counts.set(dir, 2);
  live.names.set(String(process.pid), 'claude');
  const mine = facts('pid-session', renamed, Date.now() - 5000);
  const newer = facts('newer-session', renamed, Date.now());
  for (const f of [mine, newer]) named.facts.set(f.sessionId, f);
  named.ensure('newer-session', renamed).deadSince = Date.now() - 60_000;
  named.onHook({ event: 'UserPromptSubmit', sessionId: 'pid-session', cwd: renamed, pid: process.pid });
  named.sweepClosed();
  assert.ok(!named.closed.has('pid-session'), 'a live pid keeps its own session, whatever its age');
  assert.ok(named.live.get('pid-session').pidSeen, 'a pid seen in the table is confirmed');
  live.names.delete(String(process.pid));
  live.counts.set(dir, 1);
  named.sweepClosed();
  assert.ok(named.closed.has('pid-session'), 'a confirmed pid that is gone closes its session at once');
  assert.ok(!named.closed.has('newer-session'), 'and the remaining process still accounts for the other');

  // A pid no scan ever confirmed is a claim, not a fact — a shell that forked
  // instead of exec-ing reports itself, and that must not hide a live session.
  const claimed = new Store();
  claimed.liveness = live;
  live.counts.set(dir, 1);
  const one = facts('claimed-session', renamed, Date.now());
  claimed.facts.set(one.sessionId, one);
  claimed.onHook({ event: 'UserPromptSubmit', sessionId: 'claimed-session', cwd: renamed, pid: 999_999 });
  claimed.live.get('claimed-session').deadSince = Date.now() - 60_000;
  claimed.sweepClosed();
  assert.ok(!claimed.closed.has('claimed-session'), 'an unconfirmed pid falls back to the directory count');

  console.log('Liveness checks passed: renamed cwd, cached alias, pids for jumping back, shared process budget, snapshot visibility, closed-session removal, last session closing, blind probe, pid identity, unconfirmed pid.');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
}
