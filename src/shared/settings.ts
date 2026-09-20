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
