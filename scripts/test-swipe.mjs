#!/usr/bin/env node
/**
 * Two fingers up closes the notch — and nothing else does.
 *
 * A trackpad swipe and a scroll wheel are the same event, so the rule telling
 * them apart is shape alone, and getting it wrong means either a gesture that
 * never fires or a notch that folds away while you are reading a session. This
 * replays the real shapes: a flick, a slow drag, a wheel notch, reading down a
 * panel, and a scroll that wanders both ways.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'notchlight-swipe-'));
const file = path.join(out, 'swipe.mjs');
await build({ entryPoints: ['src/renderer/swipe.ts'], bundle: true, platform: 'neutral', format: 'esm', outfile: file, logLevel: 'error' });
const { swipeStep, NO_SWIPE, SWIPE_DISTANCE, SWIPE_GAP_MS } = await import(pathToFileURL(file).href);

/** Replay a run of deltas at a given spacing; returns how many times it fired. */
function run(deltas, gapMs = 16, start = 1000) {
  let state = NO_SWIPE;
  let fired = 0;
  let now = start;
  for (const delta of deltas) {
    const result = swipeStep(state, delta, now);
    state = result.state;
    if (result.up) fired++;
    now += gapMs;
  }
  return fired;
}

const upward = (count, each) => Array.from({ length: count }, () => -each);

// A flick: a dozen frames of a few points each, well past the threshold.
assert.equal(run(upward(12, 8)), 1, 'a flick fires once');
// A slow, deliberate drag at one point a frame still gets there.
assert.equal(run(upward(60, 1)), 1, 'a slow drag fires once');
// And keeps going without firing again — one gesture, one close.
assert.equal(run(upward(120, 2)), 1, 'a long swipe is still one gesture');

// Not enough travel is not a swipe.
assert.equal(run(upward(5, 8)), 0, `${SWIPE_DISTANCE} points is the bar, and 40 does not clear it`);

// Reading down a panel must never close it.
assert.equal(run(Array.from({ length: 40 }, () => 9)), 0, 'scrolling down does nothing');

// A scroll that wanders both ways: the downward flicks abandon the run.
assert.equal(run([-10, -10, 12, -10, -10, 12, -10, -10]), 0, 'a wandering scroll never adds up');

// Fingers leaving the glass and coming back is two runs, not one.
assert.equal(run(upward(4, 8), SWIPE_GAP_MS + 50), 0, 'a pause between events ends the run');
assert.equal(run(upward(4, 8), SWIPE_GAP_MS - 20), 0, 'and 32 points is still short either way');

// Two real flicks in a row close twice, which is what a person doing that means.
let state = NO_SWIPE;
let fired = 0;
let now = 1000;
for (const chunk of [upward(8, 8), upward(8, 8)]) {
  now += 400; // fingers lifted between them
  for (const delta of chunk) {
    const result = swipeStep(state, delta, now);
    state = result.state;
    if (result.up) fired++;
    now += 16;
  }
}
assert.equal(fired, 2, 'two flicks are two gestures');

// One enormous wheel notch is a swipe, and that is the right answer: a mouse
// wheel shoved upward over the notch means the same thing a flick does.
assert.equal(run([-120]), 1, 'a single large upward delta counts');

rmSync(out, { recursive: true, force: true });
console.log('Swipe checks passed: flicks, slow drags, short travel, reading down a panel, wandering scrolls, pauses and repeats.');
