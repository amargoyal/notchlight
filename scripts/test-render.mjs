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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  const css = readFileSync('src/renderer/preview.css', 'utf8');
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

  // The tab row has a fixed 472pt to live in, because the cutout has to stay
  // dead centre of the panel. Five faces and a gear do not fit at the
  // comfortable size — they pushed the settings gear off the edge — so a
  // crowded row has to tighten.
  const crowded = renderToString(React.createElement(CompanionSurface, { live: everything, open: true, hovering: true, onCustomize() {} }));
  assert.ok(crowded.includes('is-tight'), 'five faces must tighten the tab row or the gear falls off the end');
  // A class the stylesheet says nothing about tightens nothing. This shipped
  // once: the markup carried is-tight, the rules had been lost, and every check
  // passed while the gear sat half off the panel.
  assert.ok(/^\.mp-nav\.is-tight \{/m.test(css), '.mp-nav.is-tight has no rules, so the class does nothing');
  assert.ok(/^\.mp-nav\.is-tight \.mp-count \{[^}]*display:\s*none/m.test(css), 'a tightened row must drop the counts; they are what pushes it over the edge');
  assert.ok(/^\.mp-nav > \.mp-icon-button \{[^}]*flex:\s*none/m.test(css), 'the gear must not shrink or be pushed off when the tabs get greedy');
  const roomy = liveFor({});
  const spacious = renderToString(React.createElement(CompanionSurface, { live: roomy, open: true, hovering: true, onCustomize() {} }));
  assert.ok(!spacious.includes('is-tight'), 'three faces have room and must not be squeezed for nothing');

  // Every face the panel can show needs padding on its own wrapper, or its
  // heading sits flush against the edge of the notch. Today shipped without
  // one, and no amount of rendering catches that — the class is in the markup
  // either way. So the stylesheet itself is what gets asked.
  const playing = { ...model.EMPTY_SPOTIFY, status: 'ready', playing: true, at: Date.now(), track: { id: 't', title: 'Late Light', artist: 'The Quiet Hours', album: 'Somewhere, Slowly', duration: 234 } };
  const loaded = [
    ['music', {}, 'mp-music', { music: playing }],
    ['today', { calendarEnabled: true }, 'mp-today', { calendar: { ...model.EMPTY_CALENDAR, status: 'reading' } }],
    ['tray', {}, 'mp-tray', {}],
    ['clipboard', { clipboardEnabled: true }, 'mp-clip', {}]
  ];
  for (const [view, preferences, wrapper, over] of loaded) {
    const live = liveFor(preferences, { view, ...over });
    const html = renderToString(React.createElement(CompanionSurface, { live, open: true, hovering: true, onCustomize() {} }));
    assert.ok(html.includes(wrapper), `the ${view} face must render its own .${wrapper} wrapper`);
    const rule = new RegExp(`^\\.${wrapper} \\{[^}]*padding:`, 'm');
    assert.ok(rule.test(css), `.${wrapper} has no padding rule, so the ${view} face sits flush against the edge of the notch`);
  }

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
