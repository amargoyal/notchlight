/**
 * The volume and brightness keys, answered in the notch.
 *
 * `native/hudwatch.swift` installs an event tap, swallows the key press, makes
 * the change itself and prints the new level. This supervises it and keeps the
 * one piece of state the settings pane needs: whether it is really replacing
 * the system overlay, and if not, why not.
 *
 * Everything degrades quietly. No Accessibility grant, no swiftc, a Mac whose
 * brightness cannot be read — the keys keep their own macOS overlay and nothing
 * else changes. The grant is the one the user can act on, so the helper is
 * retried on `LineHelper`'s own growing delay (5 s up to a minute) rather than
 * given up on: allowing Notchlight in System Settings takes effect within a
 * minute, without restarting anything.
 */
import { EventEmitter } from 'node:events';
import { LineHelper, parseHudEvent, type HudEvent } from './helperProcess';
import { ensureHelper } from './helpers';
import { logEvent } from './lifecycle';
import { EMPTY_HUD, type HudActivity, type HudChannel, type HudSnapshot } from '../shared/companion';

/** Option held opens the matching System Settings pane, or moves the level like any other press. */
export type HudOptionKey = 'settings' | 'replace';

const REASONS: HudSnapshot['reason'][] = ['accessibility', 'no-tap', 'no-output', 'unsupported', 'no-helper', 'crashed'];

/** The helper's ready line, as much of it as is usable. */
export function parseHudReady(line: string): Partial<HudSnapshot> & { ok: boolean } {
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'crashed' };
    if (raw.ok !== true) return { ok: false, reason: REASONS.includes(raw.reason) ? raw.reason : 'crashed' };
    const level = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
    const can = Array.isArray(raw.can) ? raw.can.filter((c: unknown): c is HudChannel => c === 'volume' || c === 'brightness') : [];
    return { ok: true, can, volume: level(raw.volume), muted: raw.muted === true, brightness: level(raw.brightness) };
  } catch { return { ok: false, reason: 'crashed' }; }
}

export class Hud extends EventEmitter {
  private helper: LineHelper<HudEvent> | null = null;
  private optionKey: HudOptionKey = 'settings';
  private wanted = false;
  private state: HudSnapshot = { ...EMPTY_HUD };
  constructor(private locate: () => Promise<string | null> = () => ensureHelper('hudwatch')) { super(); }

  snapshot(): HudSnapshot { return this.state; }

  /**
   * Start or stop the helper, and say how Option should behave. The option is
   * an argument to the helper, so changing it starts a fresh one; that costs a
   * key press at most, and only when the preference is edited.
   */
  configure(active: boolean, optionKey: HudOptionKey): void {
    const restart = this.helper !== null && optionKey !== this.optionKey;
    this.optionKey = optionKey;
    this.wanted = active;
    if (restart) { this.helper?.stop(); this.helper = null; }
    if (!active) { this.helper?.stop(); this.helper = null; this.set({ ...EMPTY_HUD }); return; }
    this.helper ??= this.build();
    this.set({ ...this.state, status: 'starting', reason: null });
    this.helper.setActive(true);
  }

  stop(): void { this.configure(false, this.optionKey); }

  private build(): LineHelper<HudEvent> {
    const helper = new LineHelper<HudEvent>('hudwatch', parseHudEvent, 'hud', async () => {
      const bin = await this.locate();
      if (!bin) this.set({ ...this.state, status: 'unavailable', reason: 'no-helper' });
      return bin;
    }, ['--option-key', this.optionKey]);
    helper.on('ready', (line: string) => {
      const head = parseHudReady(line);
      if (!head.ok) {
        logEvent('hud', `hudwatch refused: ${head.reason}`);
        this.set({ ...EMPTY_HUD, status: 'unavailable', reason: head.reason ?? 'crashed' });
        return;
      }
      logEvent('hud', `hudwatch replacing ${head.can?.join(' and ') || 'nothing'}`);
      this.set({ status: 'listening', reason: null, can: head.can ?? [], volume: head.volume ?? null, muted: head.muted === true, brightness: head.brightness ?? null });
    });
    // The helper going away while it is still wanted is a retry in progress,
    // not a verdict; a verdict already set itself from the ready line.
    helper.on('listening', (listening: boolean) => {
      if (listening || !this.wanted || this.state.status !== 'listening') return;
      this.set({ ...this.state, status: 'starting', reason: null });
    });
    helper.on('event', (event: HudEvent) => {
      this.set(event.kind === 'volume'
        ? { ...this.state, volume: event.value, muted: event.muted }
        : { ...this.state, brightness: event.value });
      const activity: HudActivity = { kind: event.kind, value: event.value, muted: event.muted, at: Date.now() };
      this.emit('activity', activity);
    });
    return helper;
  }

  private set(next: HudSnapshot) {
    const before = this.state;
    this.state = next;
    if (before.status !== next.status) logEvent('hud', `${before.status} → ${next.status}${next.reason ? ` (${next.reason})` : ''}`);
    this.emit('change', next);
  }
}
