/**
 * App-level settings: the config.json values and the macOS integrations that
 * the General and About panes edit. Face preferences live in companion.ts.
 */
export interface AppSettings {
  version: string;
  /** Login items need the packaged app; a dev checkout cannot register itself. */
  packaged: boolean;
  loginItem: boolean;
  /** Dwell, in ms, before a hover opens the notch. */
  hoverDelay: number;
  /** Electron accelerator; empty registers nothing. */
  shortcut: string;
  allowWithoutNotch: boolean;
  /** Forget a session that has said nothing for this long, in seconds. */
  staleSec: number;
  watchProcesses: boolean;
  /** 0 keeps a finished light until it is dismissed. */
  doneLingerSec: number;
  /** The measured cutout, in points, or null on a display without one. */
  cutout: { w: number; h: number } | null;
  claudeHooks: boolean;
  configDir: string;
}
export type AppSettingsPatch = Partial<Pick<AppSettings, 'loginItem' | 'hoverDelay' | 'shortcut' | 'allowWithoutNotch' | 'staleSec' | 'watchProcesses' | 'doneLingerSec'>>;
export interface AppSettingsResult { ok: boolean; error?: string; settings?: AppSettings }

export interface Choice<T> { value: T; label: string }
export const HOVER_DELAYS: Choice<number>[] = [
  { value: 150, label: '0.15 seconds' }, { value: 300, label: '0.3 seconds' }, { value: 550, label: '0.55 seconds' }, { value: 800, label: '0.8 seconds' }, { value: 1200, label: '1.2 seconds' }
];
export const STALE_CHOICES: Choice<number>[] = [
  { value: 30 * 60, label: '30 minutes' }, { value: 60 * 60, label: '1 hour' }, { value: 3 * 60 * 60, label: '3 hours' }, { value: 8 * 60 * 60, label: '8 hours' }, { value: 24 * 60 * 60, label: '1 day' }
];
export const LINGER_CHOICES: Choice<number>[] = [
  { value: 0, label: 'Until dismissed' }, { value: 5 * 60, label: '5 minutes' }, { value: 15 * 60, label: '15 minutes' }, { value: 60 * 60, label: '1 hour' }
];
/** The list with the current value in it, so an edited config.json still shows what it holds. */
export function withCurrent(choices: Choice<number>[], value: number, label: (value: number) => string): Choice<number>[] {
  if (choices.some(c => c.value === value)) return choices;
  return [...choices, { value, label: label(value) }].sort((a, b) => a.value - b.value);
}
