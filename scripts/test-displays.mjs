#!/usr/bin/env node
/**
 * Which screens carry an island, and how tall the bar is on each.
 *
 * Both answers depend on hardware this script does not have, so both are pure
 * functions taking what Electron and the Swift probe found as arguments. This
 * feeds them the arrangements that actually happen — a laptop on its own, a
 * laptop driving a monitor, a lid shut on a dock, a monitor unplugged while it
 * was the chosen one — and checks the island lands somewhere sensible in each.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'notchlight-displays-'));
const file = path.join(out, 'displays.mjs');
await build({
  entryPoints: ['src/main/notchWindow.ts'],
  bundle: true, platform: 'node', format: 'esm', outfile: file,
  external: ['electron'], logLevel: 'error',
  // Only the pure choosers are exercised; nothing here opens a window.
  alias: { electron: path.join(process.cwd(), 'scripts/stub-electron.mjs') }
});
const { chooseDisplayIds, geometryFor, isFullscreen } = await import(pathToFileURL(file).href);

const BUILT_IN = { id: 1, name: 'Built-in Retina Display', builtin: true, notch: true, notchW: 185, notchH: 32, screenW: 1512, menuBarH: 32 };
const MONITOR = { id: 3, name: 'LG ULTRAGEAR', builtin: false, notch: false, screenW: 2560, menuBarH: 30 };
const SECOND_MONITOR = { ...MONITOR, id: 4, name: 'Studio Display' };
const probes = list => id => list.find(d => d.id === id) ?? null;
const base = { displays: 'built-in', displayId: 0, allowWithoutNotch: false, plainNotchHeight: 32 };
const choose = (list, cfg, cursor = 1) => chooseDisplayIds(list.map(d => d.id), probes(list), { ...base, ...cfg }, cursor);

const laptop = [BUILT_IN];
const docked = [MONITOR, BUILT_IN];
const lidShut = [MONITOR];

assert.deepEqual(choose(laptop, {}), [1], 'one island on the built-in display');
assert.deepEqual(choose(docked, {}), [1], 'a monitor does not move the island off the notched panel');

// Without the opt-in, a screen with no cutout never gets a bar.
assert.deepEqual(choose(docked, { displays: 'all' }), [1], 'every display still means every eligible display');
assert.deepEqual(choose(docked, { displays: 'all', allowWithoutNotch: true }), [3, 1], 'opted in, both screens');
assert.deepEqual(choose(docked, { displays: 'all', allowWithoutNotch: true, plainNotchHeight: 0 }), [1], 'a zero height leaves plain screens alone');

// Following the pointer keeps exactly one island, wherever it can legally be.
assert.deepEqual(choose(docked, { displays: 'cursor', allowWithoutNotch: true }, 3), [3], 'the island follows the pointer');
assert.deepEqual(choose(docked, { displays: 'cursor', allowWithoutNotch: true }, 1), [1], 'and follows it back');
assert.deepEqual(choose(docked, { displays: 'cursor' }, 3), [1], 'the pointer cannot drag it onto an ineligible screen');

// A chosen screen that is not there falls back rather than vanishing.
assert.deepEqual(choose(docked, { displays: 'chosen', displayId: 3, allowWithoutNotch: true }), [3], 'the chosen monitor');
assert.deepEqual(choose(docked, { displays: 'chosen', displayId: 99, allowWithoutNotch: true }), [1], 'an unplugged choice falls back to the built-in panel');
assert.deepEqual(choose([BUILT_IN, SECOND_MONITOR], { displays: 'chosen', displayId: 0 }), [1], 'no choice made yet');

// A shut lid: the built-in panel is not in the list at all.
assert.deepEqual(choose(lidShut, {}), [], 'nothing eligible, so no island rather than a wrong one');
assert.deepEqual(choose(lidShut, { allowWithoutNotch: true }), [3], 'opted in, the monitor carries it');

// Heights. The display argument is what Electron reports; the probe is measured.
const display = (over = {}) => ({ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { y: 37 }, ...over });
const cfg = over => ({ notchW: 200, notchH: 32, notchHeight: 'cutout', notchHeightCustom: 40, plainNotchHeight: 32, ...over });
const size = (...args) => { const { fullscreen, ...rest } = geometryFor(...args); void fullscreen; return rest; };

assert.deepEqual(size(display(), cfg(), probes([BUILT_IN])), { notchW: 185, notchH: 37 }, 'the cutout, raised to cover the menu bar it sits in');
assert.deepEqual(size(display(), cfg({ notchHeight: 'menu-bar' }), probes([BUILT_IN])), { notchW: 185, notchH: 37 }, 'the menu bar exactly');
assert.deepEqual(size(display(), cfg({ notchHeight: 'custom' }), probes([BUILT_IN])), { notchW: 185, notchH: 40 }, 'a figure of your own wins outright');
assert.deepEqual(size(display({ id: 3, workArea: { y: 30 } }), cfg(), probes([BUILT_IN])), { notchW: 200, notchH: 32 }, 'no cutout: the fallback width and the plain height');
assert.deepEqual(size(display({ id: 3, workArea: { y: 30 } }), cfg({ plainNotchHeight: 0 }), probes([BUILT_IN])), { notchW: 200, notchH: 30 }, 'a zero plain height falls back to the menu bar');

// Something fullscreen: macOS says nothing, but the menu bar leaves the work area.
assert.equal(isFullscreen(display()), false, 'a menu bar in the work area means an ordinary desktop');
assert.equal(isFullscreen(display({ workArea: { y: 0 } })), true, 'the work area reaching the top means something took the screen');
assert.equal(geometryFor(display({ workArea: { y: 0 } }), cfg(), probes([BUILT_IN])).fullscreen, true, 'and the geometry carries it to the island');
assert.equal(geometryFor(display(), cfg(), probes([BUILT_IN])).fullscreen, false);
// A screen below the primary one: the inset is measured against its own top,
// not against zero, or every secondary display would read as fullscreen.
assert.equal(isFullscreen({ bounds: { y: -1080 }, workArea: { y: -1055 } }), false, 'a display above the primary one is measured against its own top');
assert.equal(isFullscreen({ bounds: { y: -1080 }, workArea: { y: -1080 } }), true);

rmSync(out, { recursive: true, force: true });
console.log('Display checks passed: screen selection across laptop, docked, lid-shut and unplugged arrangements, bar heights with and without a cutout, and fullscreen detection on any screen.');
