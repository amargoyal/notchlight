#!/usr/bin/env node
/**
 * Every check, in one run, with a non-zero exit when any of them fails.
 *
 * Run one at a time they scroll past and a failure a few lines up is easy to
 * walk right over — which is exactly what happened once. This runs the lot and
 * says plainly, at the end, what passed and what did not.
 */
import { spawnSync } from 'node:child_process';

const CHECKS = ['typecheck', 'helpers:check', 'test:today', 'test:swipe', 'test:battery', 'test:displays', 'test:companion', 'test:preview'];
const results = CHECKS.map(name => {
  const run = spawnSync('npm', ['run', '--silent', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const failed = run.status !== 0;
  if (failed) process.stdout.write(`\n--- ${name} ---\n${(run.stdout || '') + (run.stderr || '')}\n`);
  return { name, failed };
});

const failed = results.filter(r => r.failed);
console.log('');
for (const { name, failed: bad } of results) console.log(`${bad ? 'FAIL' : 'ok  '} ${name}`);
console.log(failed.length ? `\n${failed.length} of ${CHECKS.length} failed.` : `\nAll ${CHECKS.length} passed.`);
process.exit(failed.length ? 1 : 0);
