/**
 * Everything tunable lives in ~/.notchlight/config.json, and everything has a
 * default that works, so the file never has to exist.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_DIR = path.join(os.homedir(), '.notchlight');
export const SOCK = path.join(APP_DIR, 'notchlight.sock');
export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

export interface Config {
  /** Dwell before a hover opens the island. */
  hoverDelay: number;
  /** Grace after the cursor leaves before it closes, so a jitter is not a close. */
  leaveGrace: number;
  /** Height of the overlay window — the ceiling on how far the panel can drop. */
  windowHeight: number;
  /** Fallback cutout width when the Swift probe cannot run. */
  notchW: number;
  /** Fallback cutout height. */
  notchH: number;
  /** Breathe the light while a session works. */
  pulse: boolean;
  /** Show the island on a Mac with no cutout — it hangs off the menu bar. */
  allowWithoutNotch: boolean;
  /**
   * Tool names whose calls the daemon holds open until the island answers.
   *
   * Empty by default, and that is the whole safety story: with nothing listed,
   * no hook ever blocks, so Notchlight being slow, wedged, or half-installed
   * cannot stall a single tool call. Add `"Bash"` and the yellow card grows
   * real Allow/Deny buttons for bash — at the cost of every bash call waiting
   * on this app. Opt in deliberately.
   */
  gateTools: string[];
  /** How long a held tool call waits for an answer before giving up. */
  gateTimeoutSec: number;
  /**
   * Drop a finished session's red light after this long. 0 keeps it until the
   * session goes stale or you dismiss it, which is the default.
   */
  doneLingerSec: number;
  /** Forget a session that has said nothing for this long. */
  staleSec: number;
  /**
   * Check the process table for live `claude` processes, and drop sessions
   * whose process is gone.
   *
   * This is the only way to know a session was closed rather than left idle —
   * a terminal window shutting kills the process without writing anything down.
   * Turn it off if you would rather not have the app run `ps` and `lsof` every
   * few seconds; sessions will then linger until `staleSec`.
   */
  watchProcesses: boolean;
  /** A session whose process has been missing this long is gone. */
  processGraceSec: number;
  /**
   * Global shortcut that opens the island for the keyboard, in Electron's
   * accelerator syntax. Escape hands focus back to the app you were in.
   * Empty string registers nothing.
   */
  shortcut: string;
}

const DEFAULTS: Config = {
  hoverDelay: 550,
  leaveGrace: 220,
  windowHeight: 560,
  notchW: 200,
  notchH: 32,
  pulse: true,
  allowWithoutNotch: false,
  gateTools: [],
  gateTimeoutSec: 55,
  /**
   * Zero, deliberately.
   *
   * A red light means "finished what it was doing", not "gone" — a session
   * sitting there waiting for you to type the next thing is still a session you
   * have open, and it was disappearing off the notch fifteen minutes into
   * exactly that. Without hooks there is no way to tell a session you closed
   * from one you are still using, and of the two mistakes, hiding a session you
   * are about to type into is much the worse one. `staleSec` is the backstop;
   * clicking the red light dismisses one by hand; installing the hooks makes
   * SessionEnd remove them the moment they really do end.
   */
  doneLingerSec: 0,
  staleSec: 3 * 60 * 60,
  watchProcesses: true,
  processGraceSec: 8,
  shortcut: 'Alt+Shift+N'
};

let cached: Config | null = null;

export function ensureDir(): void {
  fs.mkdirSync(APP_DIR, { recursive: true });
}

export function config(): Config {
  if (cached) return cached;
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'config.json'), 'utf8'));
  } catch {
    /* defaults are the whole config until someone writes one */
  }
  cached = { ...DEFAULTS, ...file };
  // A zero-length gate list is the safe state; a bad type in the file must not
  // become a blocking hook by accident.
  if (!Array.isArray(cached.gateTools)) cached.gateTools = [];
  if (typeof cached.shortcut !== 'string') cached.shortcut = DEFAULTS.shortcut;
  return cached;
}

export function reloadConfig(): Config {
  cached = null;
  return config();
}

export function writeConfig(next: Partial<Config>): void {
  ensureDir();
  const merged = { ...config(), ...next };
  fs.writeFileSync(path.join(APP_DIR, 'config.json'), JSON.stringify(merged, null, 2) + '\n');
  cached = merged;
}
