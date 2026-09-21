#!/usr/bin/env node
/**
 * The few words the Today face has room for.
 *
 * Clock arithmetic is the kind of thing that looks right in the one case you
 * tried and is wrong at midnight, across a daylight saving change, or for a
 * meeting that started before you looked. So it is checked against a fixed
 * clock rather than by opening the notch at a convenient hour.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(path.join(tmpdir(), 'notchlight-today-'));
await build({
  entryPoints: ['src/renderer/today.ts', 'src/main/calendar.ts', 'src/shared/companion.ts'],
  bundle: true, platform: 'node', format: 'esm', outdir: out, outbase: 'src', external: ['electron'], logLevel: 'error'
});
// outbase keeps the src/ layout, so each bundle lands where its source sat.
const loaded = where => import(pathToFileURL(path.join(out, `${where}.js`)).href);
const { until, span, nextIndex, hasMore, clock } = await loaded('renderer/today');
const { parseCalendarDay, parseCalendarEvent, parseCalendarReady } = await loaded('main/calendar');
const { visibleEvents, nextEvent } = await loaded('shared/companion');

// A fixed morning, with an offset, so nothing depends on where this runs.
const DAY = '2026-09-20';
const at = (hhmm, over = {}) => ({
  id: `e-${hhmm}`, calendarId: 'work', title: `Event ${hhmm}`, start: `${DAY}T${hhmm}:00+00:00`,
  end: `${DAY}T${hhmm}:00+00:00`, allDay: false, location: '', kind: 'event', done: false, past: false, ...over
});
const NOW = Date.parse(`${DAY}T09:00:00+00:00`);

// How long until it starts, in the shortest true form.
assert.equal(until(at('09:08'), NOW), 'in 8m');
assert.equal(until(at('11:00'), NOW), 'in 2h');
assert.equal(until(at('09:00'), NOW), 'now', 'starting this minute is now');
assert.equal(until(at('08:30'), NOW), 'now', 'already under way is also now, not "in -30m"');
assert.equal(until(at('09:59'), NOW), 'in 59m', 'the last minute before it rounds to hours');
assert.equal(until({ ...at('09:00'), start: 'not a date' }, NOW), '', 'an unreadable start says nothing');

// The span a row shows.
assert.equal(span(at('09:41', { end: `${DAY}T10:30:00+00:00` })), `${clock(`${DAY}T09:41:00+00:00`)} – ${clock(`${DAY}T10:30:00+00:00`)}`);
assert.equal(span(at('09:41', { end: undefined })), clock(`${DAY}T09:41:00+00:00`), 'no end is just the start');
assert.equal(span(at('09:41', { end: `${DAY}T09:41:00+00:00` })), clock(`${DAY}T09:41:00+00:00`), 'a zero-length event is not "9:41 – 9:41"');
assert.equal(span(at('00:00', { allDay: true })), 'All day');

// Where the list scrolls to, and whether the day still has anything in it.
const day = [at('08:00', { past: true }), at('08:30', { past: true }), at('10:00'), at('14:00')];
assert.equal(nextIndex(day), 2, 'the first thing that has not happened');
assert.equal(nextIndex(day.map(e => ({ ...e, past: true }))), -1, 'a day that is over scrolls nowhere');
assert.equal(hasMore(day), true);
assert.equal(hasMore(day.map(e => ({ ...e, past: true }))), false);
assert.equal(nextEvent(day).id, day[2].id, 'the resting bar carries the same one');
assert.equal(nextEvent([]), null);
// A ticked-off reminder is behind you even if its time has not come.
assert.equal(nextIndex([at('10:00', { kind: 'reminder', done: true }), at('11:00')]), 1);

// What gets left out.
const mixed = [at('09:30'), at('00:00', { id: 'all', allDay: true }), at('10:00', { id: 'r', kind: 'reminder', done: true }), at('11:00', { id: 'home', calendarId: 'home' })];
const show = (over = {}) => visibleEvents(mixed, { calendarHidden: [], hideAllDay: false, hideDone: false, ...over }).map(e => e.id);
assert.equal(show().length, 4, 'nothing hidden by default');
assert.ok(!show({ hideAllDay: true }).includes('all'));
assert.ok(!show({ hideDone: true }).includes('r'));
assert.ok(!show({ calendarHidden: ['home'] }).includes('home'));
assert.deepEqual(show({ calendarHidden: ['home'], hideAllDay: true, hideDone: true }), ['e-09:30'], 'all three rules together');

// The helper's lines.
const line = JSON.stringify({ day: DAY, events: [at('09:30'), { id: '', title: 'no id' }, { id: 'x', start: 'rubbish' }] });
const parsed = parseCalendarDay(line);
assert.equal(parsed.day, DAY);
assert.equal(parsed.events.length, 1, 'an event with no id or an unreadable start is dropped, not drawn');
assert.equal(parseCalendarDay('{"day":"x"}'), null, 'a line with no list is not a day');
assert.equal(parseCalendarDay('half a line'), null);
assert.equal(parseCalendarEvent({ id: 'a', start: `${DAY}T09:00:00+00:00` }).title, 'Untitled', 'an untitled event still shows');
assert.equal(parseCalendarEvent({ id: 'a', start: `${DAY}T09:00:00+00:00`, kind: 'reminder' }).kind, 'reminder');
assert.equal(parseCalendarReady('{"ok":false,"reason":"denied"}').reason, 'denied');
assert.equal(parseCalendarReady('{"ok":false,"reason":"made up"}').reason, 'crashed', 'an unknown refusal is not passed through');
const ready = parseCalendarReady('{"ok":true,"reminders":true,"calendars":[{"id":"w","title":"Work","color":"#c97c5c","kind":"event"},{"id":"","title":"no id"},{"id":"b","color":"nonsense"}]}');
assert.equal(ready.calendars.length, 2, 'a calendar with no id is dropped');
assert.equal(ready.calendars[1].color, '#8d8a84', 'a colour that is not a colour falls back');
assert.equal(ready.reminders, true);

rmSync(out, { recursive: true, force: true });
console.log('Today checks passed: countdowns around the current minute, spans, scroll target, the three hiding rules, and the helper’s lines.');
