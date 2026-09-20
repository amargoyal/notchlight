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

/** What the browser preview shows in General, where nothing can be applied. */
export const SAMPLE_APP_SETTINGS: AppSettings = {
  version: '0.2.0', packaged: false, loginItem: false, hoverDelay: 550, shortcut: 'Alt+Shift+N', allowWithoutNotch: false,
  staleSec: 3 * 60 * 60, watchProcesses: true, doneLingerSec: 0, cutout: { w: 200, h: 32 }, claudeHooks: false, configDir: '~/.notchlight'
};

/** ⌥⇧N for a menu or a row, from Electron's accelerator spelling. */
export function shortcutLabel(accelerator: string): string {
  const names: Record<string, string> = { commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', super: '⌘', meta: '⌘', space: 'Space', escape: 'Esc', return: '↩', enter: '↩', tab: '⇥', up: '↑', down: '↓', left: '←', right: '→' };
  return accelerator.split('+').filter(Boolean).map(part => names[part.toLowerCase()] ?? part.toUpperCase()).join('');
}

/** Only known, correctly typed settings may cross the renderer boundary. */
export function validateAppSettings(value: unknown): AppSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings.');
  const result: AppSettingsPatch = {};
  const integer = (item: unknown, min: number, max: number, what: string): number => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max) throw new Error(`${what} is out of range.`);
    return Math.round(item);
  };
  for (const [key, item] of Object.entries(value)) {
    switch (key) {
      case 'loginItem': case 'allowWithoutNotch': case 'watchProcesses':
        if (typeof item !== 'boolean') throw new Error('Invalid setting value.');
        result[key] = item; break;
      case 'hoverDelay': result.hoverDelay = integer(item, 0, 5000, 'The hover delay'); break;
      case 'staleSec': result.staleSec = integer(item, 60, 7 * 24 * 60 * 60, 'The session timeout'); break;
      case 'doneLingerSec': result.doneLingerSec = integer(item, 0, 24 * 60 * 60, 'The finished-light delay'); break;
      case 'shortcut':
        if (typeof item !== 'string' || item.length > 64 || !/^([A-Za-z0-9]+\+)*[A-Za-z0-9]*$/.test(item)) throw new Error('That is not a shortcut Notchlight can register.');
        result.shortcut = item; break;
      default: throw new Error('Unknown setting.');
    }
  }
  return result;
}
