/**
 * Today, read from EventKit.
 *
 * `native/calendarwatch.swift` asks macOS once, prints today's events, and
 * prints them again whenever the store changes or the day rolls over. This
 * supervises it and keeps the day for the Today face.
 *
 * The permission is the thing to get right. macOS asks once and remembers the
 * answer, so a refusal is not something to retry into — the helper would be
 * spawned every minute to be told no by a system that is not going to ask
 * again. It becomes a state the pane can explain, with the pane it can be
 * changed in named, and nothing tries again until the preference is switched
 * off and on.
 */
import { EventEmitter } from 'node:events';
import { LineHelper } from './helperProcess';
import { ensureHelper } from './helpers';
import { logEvent } from './lifecycle';
import { EMPTY_CALENDAR, type CalendarEvent, type CalendarInfo, type CalendarSnapshot } from '../shared/companion';

/** One day's worth of events, as the helper prints them. */
export interface CalendarDay { day: string; events: CalendarEvent[] }

const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

/** One event from the helper's list, or null when it is not usable. */
export function parseCalendarEvent(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = text(item.id);
  const start = text(item.start);
  // A thing with no identity cannot be keyed, and one with no start cannot be
  // placed on a day. Either way there is nothing to draw.
  if (!id || !start || Number.isNaN(Date.parse(start))) return null;
  const end = text(item.end);
  return {
    id,
    calendarId: text(item.calendarId),
    title: text(item.title, 'Untitled'),
    start,
    ...(end && !Number.isNaN(Date.parse(end)) ? { end } : {}),
    allDay: item.allDay === true,
    location: text(item.location),
    kind: item.kind === 'reminder' ? 'reminder' : 'event',
    done: item.done === true,
    past: item.past === true
  };
}

/** One calendarwatch line into a day, or null. */
export function parseCalendarDay(line: string): CalendarDay | null {
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.events)) return null;
    const events = raw.events.map(parseCalendarEvent).filter((e: CalendarEvent | null): e is CalendarEvent => e !== null);
    return { day: text(raw.day), events };
  } catch { return null; }
}

/** The helper's ready line: the calendars it can see, or why it can see none. */
export function parseCalendarReady(line: string): { ok: boolean; reason?: CalendarSnapshot['reason']; calendars?: CalendarInfo[]; reminders?: boolean } {
  const reasons: CalendarSnapshot['reason'][] = ['denied', 'restricted', 'unsupported', 'no-helper', 'crashed'];
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'crashed' };
    if (raw.ok !== true) return { ok: false, reason: reasons.includes(raw.reason) ? raw.reason : 'crashed' };
    const list: unknown[] = Array.isArray(raw.calendars) ? raw.calendars : [];
    const calendars = list.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const id = text(item.id);
      if (!id) return [];
      return [{
        id,
        title: text(item.title, 'Calendar'),
        color: /^#[0-9a-f]{6}$/i.test(text(item.color)) ? text(item.color) : '#8d8a84',
        kind: item.kind === 'reminder' ? 'reminder' as const : 'event' as const
      }];
    });
    return { ok: true, calendars, reminders: raw.reminders === true };
  } catch { return { ok: false, reason: 'crashed' }; }
}

export class Calendar extends EventEmitter {
  private helper: LineHelper<CalendarDay> | null = null;
  private wanted = false;
  private stopped = false;
  private reminders = false;
  private state: CalendarSnapshot = { ...EMPTY_CALENDAR };
  constructor(private locate: () => Promise<string | null> = () => ensureHelper('calendarwatch')) { super(); }

  snapshot(): CalendarSnapshot { return this.state; }

  /**
   * Start or stop reading. Asking for reminders is a second macOS permission,
   * so changing it starts a fresh helper — there is no way to ask for more
   * later in a process that has already asked for less.
   */
  configure(active: boolean, reminders: boolean): void {
    if (this.stopped) return;
    const restart = this.helper !== null && reminders !== this.reminders;
    this.reminders = reminders;
    this.wanted = active;
    if (restart) { this.helper?.stop(); this.helper = null; }
    if (!active) { this.helper?.stop(); this.helper = null; this.set({ ...EMPTY_CALENDAR }); return; }
    const fresh = this.helper === null;
    this.helper ??= this.build();
    if (fresh) this.set({ ...EMPTY_CALENDAR, status: 'starting' });
    // macOS asks once. Spawning a helper every minute to be refused again by a
    // system that will not ask again is noise, not persistence.
    else if (this.state.status === 'unavailable') return;
    this.helper.setActive(true);
  }

  stop(): void {
    // The flag goes up first: tearing down emits a change, the companion store
    // answers it, and the answer comes straight back here.
    this.stopped = true;
    this.wanted = false;
    this.helper?.stop();
    this.helper = null;
    this.set({ ...EMPTY_CALENDAR });
  }

  private build(): LineHelper<CalendarDay> {
    const helper = new LineHelper<CalendarDay>('calendarwatch', parseCalendarDay, 'calendar', async () => {
      const bin = await this.locate();
      if (!bin) this.set({ ...this.state, status: 'unavailable', reason: 'no-helper' });
      return bin;
    }, this.reminders ? ['--reminders'] : []);
    helper.on('ready', (line: string) => {
      const head = parseCalendarReady(line);
      if (!head.ok) {
        logEvent('calendar', `calendarwatch refused: ${head.reason}`);
        this.set({ ...EMPTY_CALENDAR, status: 'unavailable', reason: head.reason ?? 'crashed' });
        return;
      }
      logEvent('calendar', `reading ${head.calendars?.length ?? 0} calendars${head.reminders ? ' and reminders' : ''}`);
      this.set({ ...this.state, status: 'reading', reason: null, calendars: head.calendars ?? [], reminders: head.reminders === true });
    });
    helper.on('listening', (listening: boolean) => {
      if (listening || !this.wanted || this.state.status !== 'reading') return;
      this.set({ ...this.state, status: 'starting', reason: null });
    });
    helper.on('event', (day: CalendarDay) => {
      this.set({ ...this.state, status: 'reading', reason: null, day: day.day, events: day.events });
    });
    return helper;
  }

  private set(next: CalendarSnapshot) {
    const before = this.state;
    if (before.status === next.status && before.reason === next.reason && before.day === next.day
      && before.reminders === next.reminders && sameEvents(before.events, next.events)
      && before.calendars.length === next.calendars.length && before.calendars.every((c, i) => c.id === next.calendars[i].id && c.title === next.calendars[i].title && c.color === next.calendars[i].color)) return;
    this.state = next;
    if (before.status !== next.status) logEvent('calendar', `${before.status} → ${next.status}${next.reason ? ` (${next.reason})` : ''}`);
    this.emit('change', next);
  }
}

/** Same things, in the same order, in the same state. */
function sameEvents(before: CalendarEvent[], after: CalendarEvent[]): boolean {
  return before.length === after.length && before.every((event, i) => {
    const other = after[i];
    return event.id === other.id && event.title === other.title && event.start === other.start
      && event.end === other.end && event.done === other.done && event.past === other.past;
  });
}
