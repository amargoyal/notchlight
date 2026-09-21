#!/usr/bin/env node
/**
 * Every face, actually rendered.
 *
 * The other checks exercise logic; this one runs the components. It exists
 * because a reference to a `const` declared further down the component threw
 * only when the Today tab appeared — the notch went blank and the settings
 * window went white, and nothing else here would have caught it. Rendering to a
 * string is enough: a throw is a throw whether or not there is a browser.
 *
 * Effects and layout do not run, so this proves a face renders rather than that
 * it behaves. That is exactly the class of bug it is here for.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'notchlight-render-'));
// The entry sits in the repo so React and the renderer sources resolve normally.
const entry = path.join(process.cwd(), '.render-check.tsx');
writeFileSync(entry, `
import { renderToString } from 'react-dom/server';
import { CompanionSurface } from './src/renderer/LiveCompanion';
import { PreviewSurface } from './src/renderer/Preview';
import { initialPreview } from './src/renderer/previewModel';
export { renderToString, CompanionSurface, PreviewSurface, initialPreview };
export * as model from './src/shared/companion';
`);
try {
  const outfile = path.join(out, 'render.cjs');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'error' });
  globalThis.window = { notchlight: undefined };
  const { renderToString, CompanionSurface, PreviewSurface, initialPreview, model } = await import(pathToFileURL(outfile).href).then(m => m.default ?? m);
  const React = await import('react');

  const snapshot = { sessions: [], overall: 'idle', tokens: 0, elapsed: 0, dormant: true, notchW: 200, notchH: 32, hoverDelay: 550, pulse: true, now: Date.now() };
  const liveFor = (preferences, over = {}) => ({
    available: true, ready: true, error: '', fullscreen: false, run: () => {}, snapshot,
    state: {
      preferences: { ...model.DEFAULT_COMPANION_PREFERENCES, ...preferences },
      view: 'agents', files: [], music: { ...model.EMPTY_SPOTIFY }, capture: { ...model.EMPTY_CAPTURE },
      hud: { ...model.EMPTY_HUD }, battery: { ...model.EMPTY_BATTERY }, calendar: { ...model.EMPTY_CALENDAR },
      clipboard: { ...model.EMPTY_CLIPBOARD }, smartShuffle: { ...model.EMPTY_SMART_SHUFFLE },
      transfer: null, undoable: 0, notice: '', ...over
    }
  });

  const renders = (what, element) => {
    try { renderToString(element); }
    catch (error) { assert.fail(`${what} threw: ${error.message}`); }
  };

  // Every face, open and collapsed, with its feature on — which is when the
  // tab appears and the code paths behind it are reached at all.
  const faces = [
    ['agents', {}],
    ['music', {}],
    ['today', { calendarEnabled: true }],
    ['tray', {}],
    ['clipboard', { clipboardEnabled: true }]
  ];
  for (const [view, preferences] of faces) {
    for (const open of [true, false]) {
      const live = liveFor(preferences, { view });
      renders(`${view} ${open ? 'open' : 'collapsed'}`, React.createElement(CompanionSurface, { live, open, hovering: true, onCustomize() {} }));
    }
  }

  // Today in each state it can be in, since the refusals have their own branch.
  for (const calendar of [
    { status: 'unavailable', reason: 'denied' },
    { status: 'unavailable', reason: 'no-helper' },
    { status: 'starting', reason: null },
    { status: 'reading', reason: null, day: '2026-09-20', calendars: [{ id: 'w', title: 'Work', color: '#c97c5c', kind: 'event' }], events: [{ id: 'a', calendarId: 'w', title: 'Standup', start: new Date().toISOString(), end: new Date().toISOString(), allDay: false, location: '', kind: 'event', done: false, past: false }] }
  ]) {
    const live = liveFor({ calendarEnabled: true }, { view: 'today', calendar: { ...model.EMPTY_CALENDAR, ...calendar } });
    renders(`today ${calendar.status}/${calendar.reason}`, React.createElement(CompanionSurface, { live, open: true, hovering: true, onCustomize() {} }));
  }

  // Everything on at once: the resting bar with every face competing for it.
  const everything = liveFor({ calendarEnabled: true, clipboardEnabled: true, batteryEnabled: true, hudEnabled: true, restToday: true });
  renders('everything on, collapsed', React.createElement(CompanionSurface, { live: everything, open: false, hovering: false, onCustomize() {} }));

  // And the sample surface, which the settings window and the gallery both draw.
  for (const view of ['agents', 'music', 'today', 'tray', 'clipboard']) {
    const state = { ...initialPreview(), view, preferences: { ...initialPreview().preferences, calendarEnabled: true, clipboardEnabled: true, batteryEnabled: true } };
    renders(`preview ${view}`, React.createElement(PreviewSurface, { state, dispatch: () => {}, onCustomize() {} }));
  }

  console.log('Render checks passed: every face open and collapsed, Today in each of its states, everything on at once, and the sample surface.');
} finally {
  rmSync(entry, { force: true });
  rmSync(out, { recursive: true, force: true });
}
