/**
 * Turning today's events into the few words the notch has room for.
 *
 * All of this is arithmetic on clock times, which is exactly the kind of thing
 * that looks right in the one case you tried and is wrong at midnight, over a
 * daylight saving change, or for an event that started before you looked. So it
 * lives here, away from the component, and is checked directly.
 */
import type { CalendarEvent } from '../shared/companion';

/** `9:41`, in the Mac's own 12- or 24-hour preference. */
export function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * How long until it starts, in the shortest true form: `now`, `in 8m`, `in 2h`.
 * Something already under way says `now`; something finished says nothing, and
 * the caller is expected not to ask.
 */
export function until(event: CalendarEvent, now = Date.now()): string {
  const start = Date.parse(event.start);
  if (Number.isNaN(start)) return '';
  const minutes = Math.round((start - now) / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/**
 * The span a row shows: `9:41 – 10:30`, `9:41` for something with no end, and
 * `All day` for an event that takes the whole of it.
 */
export function span(event: CalendarEvent): string {
  if (event.allDay) return 'All day';
  const start = clock(event.start);
  const end = event.end ? clock(event.end) : '';
  return end && end !== start ? `${start} – ${end}` : start;
}

/**
 * Where the list should be scrolled to: the first thing that has not happened.
 *
 * Returned as an index rather than a scroll offset, so the component can decide
 * what "into view" means. -1 when the day is over, which is the one case where
 * leaving the list at the top would be wrong and scrolling anywhere would be
 * worse.
 */
export function nextIndex(events: CalendarEvent[]): number {
  return events.findIndex(event => !event.past && !event.done);
}

/** Whether the day still has something coming. */
export function hasMore(events: CalendarEvent[]): boolean {
  return events.some(event => !event.past && !event.done);
}
