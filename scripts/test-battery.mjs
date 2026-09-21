#!/usr/bin/env node
/**
 * Which battery readings are worth a moment of the notch.
 *
 * A battery emits a line for every percent, and almost none of them are news.
 * The rule that picks the few that are cannot be tried by hand — you would have
 * to run a Mac flat — so it is a pure function, and this walks it through a day:
 * plugged in, charged, unplugged, run down past the warning, wobbling on the
 * mark, and flat.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'notchlight-battery-'));
// esbuild names each output after its entry point, so both land in `out` as .js.
const loaded = name => import(pathToFileURL(path.join(out, `${name}.js`)).href);
await build({
  entryPoints: ['src/main/battery.ts', 'src/main/helperProcess.ts'], bundle: true, platform: 'node',
  format: 'esm', outdir: out, external: ['electron'], logLevel: 'error'
});
const { batteryEventFor, parsePowerReady } = await loaded('battery');
const { parsePowerEvent } = await loaded('helperProcess');

const reading = (over = {}) => ({ status: 'reading', reason: null, percent: 0.5, charging: false, plugged: false, charged: false, minutes: 120, ...over });
const step = (from, to, warned = false) => batteryEventFor(reading(from), reading(to), warned).event;

// The charger.
assert.equal(step({ plugged: false }, { plugged: true, charging: true }), 'plugged');
assert.equal(step({ plugged: true, charging: true }, { plugged: false }), 'unplugged');
assert.equal(step({ plugged: true, charging: true }, { plugged: true, charging: true, percent: 0.6 }), null, 'charging along is not news');
assert.equal(step({ plugged: true, charging: true, percent: 0.99 }, { plugged: true, charging: false, charged: true, percent: 1 }), 'charged');
assert.equal(step({ plugged: true, charged: true }, { plugged: true, charged: true }), null, 'charged is announced once');

// The warning, given once on the way down. The third argument is whether it has
// already been given, which is the latch the class carries between readings.
assert.equal(step({ percent: 0.21 }, { percent: 0.2 }), 'low', 'twenty percent on the way down');
assert.equal(step({ percent: 0.2 }, { percent: 0.19 }, true), null, 'and not again on the next percent');
assert.equal(step({ percent: 0.19 }, { percent: 0.05 }, true), null, 'nor all the way down');
assert.equal(step({ percent: 0.21, plugged: true }, { percent: 0.2, plugged: true }), null, 'not while it is on the charger');

// A battery drifting around the mark — which IOKit's percentage really does —
// must warn once and then stay quiet until it is properly clear of it again.
const walk = (levels, over = {}) => {
  let before = reading({ percent: levels[0], ...over });
  let warned = false;
  const events = [];
  for (const percent of levels.slice(1)) {
    const after = reading({ percent, ...over });
    const result = batteryEventFor(before, after, warned);
    warned = result.warned;
    if (result.event) events.push(result.event);
    before = after;
  }
  return events;
};
assert.deepEqual(walk([0.21, 0.2, 0.21, 0.2, 0.21, 0.2]), ['low'], 'one warning, however much it wobbles');
assert.deepEqual(walk([0.21, 0.2, 0.19, 0.1, 0.05, 0.01]), ['low'], 'and nothing more on the way down');
assert.deepEqual(walk([0.3, 0.2, 0.26, 0.2]), ['low', 'low'], 'properly back above the mark earns a second warning');

// Unplugging straight into the warning zone says one thing, not two.
assert.equal(step({ percent: 0.1, plugged: true }, { percent: 0.1, plugged: false }), 'unplugged', 'the charger outranks the level');
assert.equal(batteryEventFor(reading({ percent: 0.1 }), reading({ percent: 0.1, plugged: true }), true).warned, false, 'the charger clears the warning');

// The first reading is not a change from anything.
assert.equal(batteryEventFor({ ...reading(), percent: null }, reading({ percent: 0.05 }), false).event, null, 'the first reading never interrupts');

// The helper's own lines.
assert.deepEqual(parsePowerEvent('{"percent":0.8,"charging":false,"plugged":false,"charged":false,"minutes":416}'),
  { percent: 0.8, charging: false, plugged: false, charged: false, minutes: 416 });
assert.equal(parsePowerEvent('{"percent":0.8,"minutes":null}').minutes, null, 'no estimate yet');
assert.equal(parsePowerEvent('{"percent":0.8,"minutes":-1}').minutes, null, 'IOKit says -1 for "ask me later"');
assert.equal(parsePowerEvent('{"percent":"half"}'), null);
assert.equal(parsePowerEvent('nonsense'), null);
assert.equal(parsePowerReady('{"ok":false,"reason":"no-battery"}').reason, 'no-battery');
assert.equal(parsePowerReady('{"ok":true,"percent":0.8,"minutes":416}').reading.percent, 0.8);
assert.equal(parsePowerReady('half a line').reason, 'crashed');

rmSync(out, { recursive: true, force: true });
console.log('Battery checks passed: charger in and out, charge finishing, one warning however much the level wobbles, and the helper’s lines.');
