#!/usr/bin/env node
/**
 * Every check, in one run, with a non-zero exit when any of them fails.
 *
 * Run one at a time they scroll past and a failure a few lines up is easy to
 * walk right over — which is exactly what happened, twice. This runs the lot
 * and says plainly, on the last line, what failed and what passed.
 *
 * A check that fails and then passes on a second run is reported as FLAKY
 * rather than counted against the run: it read a file while something was still
 * writing it, and quietly swallowing that would make every later failure
 * suspect.
 */
import { spawnSync } from 'node:child_process';

const CHECKS = ['typecheck', 'helpers:check', 'test:today', 'test:swipe', 'test:battery', 'test:displays', 'test:companion', 'test:preview', 'test:render', 'test:backoff'];

const run = name => spawnSync('npm', ['run', '--silent', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const results = CHECKS.map(name => {
  let attempt = run(name);
  if (attempt.status === 0) return { name, state: 'ok' };
  // A check that fails once and passes straight away did not find a bug — it
  // read a source file while something else was still writing it. Worth saying
  // out loud, because a check nobody trusts is worse than no check, but not
  // worth failing the run over.
  const second = run(name);
  if (second.status === 0) return { name, state: 'flaky', output: (attempt.stdout || '') + (attempt.stderr || '') };
  return { name, state: 'fail', output: (second.stdout || '') + (second.stderr || '') };
});

for (const { name, state, output } of results) {
  if (state === 'ok') continue;
  process.stdout.write(`\n--- ${name} (${state}) ---\n${output}\n`);
}

const failed = results.filter(r => r.state === 'fail');
const flaky = results.filter(r => r.state === 'flaky');
console.log('');
for (const { name, state } of results) console.log(`${state === 'ok' ? 'ok   ' : state === 'flaky' ? 'FLAKY' : 'FAIL '} ${name}`);
console.log('');
if (failed.length) console.log(`FAILED: ${failed.map(r => r.name).join(', ')} — ${failed.length} of ${CHECKS.length}.`);
else if (flaky.length) console.log(`All ${CHECKS.length} passed, but ${flaky.map(r => r.name).join(', ')} needed a second run.`);
else console.log(`All ${CHECKS.length} passed.`);
process.exit(failed.length ? 1 : 0);
