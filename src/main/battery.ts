/**
 * The battery, and the moments worth a word about it.
 *
 * `native/powerwatch.swift` watches IOKit and prints a line whenever the
 * battery moves. Most of those lines are one percent going by, which is not
 * news; this keeps the current reading for the resting bar and picks out the
 * few changes that deserve a moment of the notch — the charger going in or
 * coming out, the last of the battery going, and the charge finishing.
 *
 * A Mac with no internal battery is not a failure. The helper says so on its
 * first line, the pane repeats it plainly, and nothing retries.
 */
import { EventEmitter } from 'node:events';
import { LineHelper, parsePowerEvent, type PowerEvent } from './helperProcess';
import { ensureHelper } from './helpers';
import { logEvent } from './lifecycle';
import { batteryIsLow, EMPTY_BATTERY, LOW_BATTERY, type BatteryActivity, type BatteryEvent, type BatterySnapshot } from '../shared/companion';

/** The helper's ready line: a reading, or why there is none. */
export function parsePowerReady(line: string): { ok: boolean; reason?: BatterySnapshot['reason']; reading?: PowerEvent } {
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'crashed' };
    if (raw.ok !== true) return { ok: false, reason: raw.reason === 'no-battery' ? 'no-battery' : 'crashed' };
    const reading = parsePowerEvent(line);
    return reading ? { ok: true, reading } : { ok: false, reason: 'crashed' };
  } catch { return { ok: false, reason: 'crashed' }; }
}

/** Once warned, stay quiet until the battery is properly back above the mark. */
export const REARM_BATTERY = LOW_BATTERY + 0.05;

/**
 * What, if anything, this reading is worth interrupting for, and whether the
 * low warning has been spent.
 *
 * The charger outranks the level: unplugging at eight percent says the charger
 * came out, not that the battery is low — you know it is low, you just took the
 * cable out. The warning itself is announced once and then latched, because
 * IOKit's percentage does not fall cleanly: it drifts back up a point now and
 * then, and "crossed twenty percent" on its own would announce every wobble.
 * The latch clears on the charger, or once the level is properly clear of the
 * mark again.
 */
export function batteryEventFor(before: BatterySnapshot, after: BatterySnapshot, warned: boolean): { event: BatteryEvent | null; warned: boolean } {
  const clear = after.plugged || (after.percent ?? 1) > REARM_BATTERY;
  const armed = warned && !clear;
  if (before.percent === null) return { event: null, warned: armed };
  if (after.plugged && !before.plugged) return { event: 'plugged', warned: false };
  if (!after.plugged && before.plugged) return { event: 'unplugged', warned: armed };
  if (after.charged && !before.charged) return { event: 'charged', warned: false };
  if (batteryIsLow(after) && !armed) return { event: 'low', warned: true };
  return { event: null, warned: armed };
}

export class Battery extends EventEmitter {
  private helper: LineHelper<PowerEvent> | null = null;
  private wanted = false;
  private stopped = false;
  private state: BatterySnapshot = { ...EMPTY_BATTERY };
  /** The low warning has been given and not yet earned back. */
  private warned = false;
  constructor(private locate: () => Promise<string | null> = () => ensureHelper('powerwatch')) { super(); }

  snapshot(): BatterySnapshot { return this.state; }

  setActive(active: boolean): void {
    if (this.stopped) return;
    this.wanted = active;
    if (!active) { this.helper?.stop(); this.helper = null; this.set({ ...EMPTY_BATTERY }); return; }
    const fresh = this.helper === null;
    this.helper ??= this.build();
    if (fresh) this.set({ ...EMPTY_BATTERY, status: 'starting' });
    // No battery and no helper are both permanent for this helper's life; only
    // switching the preference off and on is worth another look.
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
    this.set({ ...EMPTY_BATTERY });
  }

  private build(): LineHelper<PowerEvent> {
    const helper = new LineHelper<PowerEvent>('powerwatch', parsePowerEvent, 'power', async () => {
      const bin = await this.locate();
      if (!bin) this.set({ ...this.state, status: 'unavailable', reason: 'no-helper' });
      return bin;
    });
    helper.on('ready', (line: string) => {
      const head = parsePowerReady(line);
      if (!head.ok || !head.reading) {
        logEvent('power', `powerwatch refused: ${head.reason}`);
        this.set({ ...EMPTY_BATTERY, status: 'unavailable', reason: head.reason ?? 'crashed' });
        return;
      }
      logEvent('power', `battery ${Math.round(head.reading.percent * 100)}%${head.reading.plugged ? ' on the charger' : ''}`);
      this.apply(head.reading, false);
    });
    helper.on('listening', (listening: boolean) => {
      if (listening || !this.wanted || this.state.status !== 'reading') return;
      this.set({ ...this.state, status: 'starting', reason: null });
    });
    helper.on('event', (event: PowerEvent) => this.apply(event, true));
    return helper;
  }

  /** A reading becomes the state, and sometimes a moment in the notch as well. */
  private apply(reading: PowerEvent, announce: boolean) {
    const before = this.state;
    const next: BatterySnapshot = { status: 'reading', reason: null, ...reading };
    this.set(next);
    const { event, warned } = batteryEventFor(before, next, this.warned);
    this.warned = warned;
    if (!announce || !event) return;
    logEvent('power', `${event} at ${Math.round(reading.percent * 100)}%`);
    const activity: BatteryActivity = { event, percent: next.percent ?? 0, minutes: next.minutes, at: Date.now() };
    this.emit('activity', activity);
  }

  private set(next: BatterySnapshot) {
    const before = this.state;
    if (before.status === next.status && before.reason === next.reason && before.percent === next.percent
      && before.charging === next.charging && before.plugged === next.plugged
      && before.charged === next.charged && before.minutes === next.minutes) return;
    this.state = next;
    if (before.status !== next.status) logEvent('power', `${before.status} → ${next.status}${next.reason ? ` (${next.reason})` : ''}`);
    this.emit('change', next);
  }
}
