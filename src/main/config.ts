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
   * Which screens carry an island.
   *
   * `built-in` is the notched panel and nothing else, which is what Notchlight
   * has always done. `all` puts one on every screen. `cursor` keeps a single
   * island and moves it to whichever screen the pointer is on. `chosen` pins it
   * to `displayId`, and falls back to the built-in one when that screen is
   * unplugged.
   */
  displays: 'built-in' | 'all' | 'cursor' | 'chosen';
  /** The screen `displays: "chosen"` means, as a CGDirectDisplayID. 0 until one is picked. */
  displayId: number;
  /**
   * How tall the collapsed bar is on a screen with a cutout: the cutout itself,
   * the menu bar it sits in, or a figure of your own.
   */
  notchHeight: 'cutout' | 'menu-bar' | 'custom';
  /** The figure `notchHeight: "custom"` means, in points, 15 to 45. */
  notchHeightCustom: number;
  /**
   * The bar's height on a screen with no cutout, in points, 0 to 40. There is
   * no hole to match there, so the island hangs off the menu bar at whatever
   * height reads best. 0 leaves those screens alone.
   */
  plainNotchHeight: number;
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
  /**
   * A session whose process has been missing this long is gone.
   *
   * Only for sessions the directory count has to guess at. A session whose own
   * process id a hook named, and a scan confirmed, closes the moment that pid
   * leaves the process table — there is nothing there to wait out.
   */
  processGraceSec: number;
  /**
   * Global shortcut that opens the island for the keyboard, in Electron's
   * accelerator syntax. Escape hands focus back to the app you were in.
   * Empty string registers nothing.
   */
  shortcut: string;
  /**
   * Milliseconds added to the output device's reported latency before the
   * equalizer bars are shown. Zero trusts Core Audio's figure. AirPods report
   * an estimate; if the bars run early, try 80; if late, try -80.
   */
  levelsOffsetMs: number;
  /**
   * How many times a second the equalizer helper prints a level, and so how
   * often the bars move. Higher reacts sooner — at 24 a bar could be up to
   * 42 ms behind the beat purely from waiting its turn — but every frame
   * recomposites the transparent overlay, so it is also directly more GPU.
   * 60 by default; drop it to 24 to spend less.
   */
  levelsFps: number;
}

const DEFAULTS: Config = {
  hoverDelay: 550,
  leaveGrace: 220,
  windowHeight: 560,
  notchW: 200,
  notchH: 32,
  pulse: true,
  allowWithoutNotch: false,
  displays: 'built-in',
  displayId: 0,
  notchHeight: 'cutout',
  notchHeightCustom: 32,
  plainNotchHeight: 32,
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
  shortcut: 'Alt+Shift+N',
  levelsOffsetMs: 0,
  levelsFps: 60
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
  if (typeof cached.levelsOffsetMs !== 'number' || !Number.isFinite(cached.levelsOffsetMs)) cached.levelsOffsetMs = 0;
  cached.levelsOffsetMs = Math.max(-2000, Math.min(2000, Math.round(cached.levelsOffsetMs)));
  if (typeof cached.levelsFps !== 'number' || !Number.isFinite(cached.levelsFps)) cached.levelsFps = DEFAULTS.levelsFps;
  // The helper refuses anything outside 5…60 and would fall back to its own
  // default, so clamp here rather than hand it a figure it will ignore.
  cached.levelsFps = Math.max(12, Math.min(60, Math.round(cached.levelsFps)));
  // A display rule out of range would leave the island on no screen at all, or
  // at a height that cannot cover the menu bar. Fall back rather than obey.
  if (!['built-in', 'all', 'cursor', 'chosen'].includes(cached.displays)) cached.displays = DEFAULTS.displays;
  if (typeof cached.displayId !== 'number' || !Number.isFinite(cached.displayId) || cached.displayId < 0) cached.displayId = 0;
  cached.displayId = Math.round(cached.displayId);
  if (!['cutout', 'menu-bar', 'custom'].includes(cached.notchHeight)) cached.notchHeight = DEFAULTS.notchHeight;
  if (typeof cached.notchHeightCustom !== 'number' || !Number.isFinite(cached.notchHeightCustom)) cached.notchHeightCustom = DEFAULTS.notchHeightCustom;
  cached.notchHeightCustom = Math.max(15, Math.min(45, Math.round(cached.notchHeightCustom)));
  if (typeof cached.plainNotchHeight !== 'number' || !Number.isFinite(cached.plainNotchHeight)) cached.plainNotchHeight = DEFAULTS.plainNotchHeight;
  cached.plainNotchHeight = Math.max(0, Math.min(40, Math.round(cached.plainNotchHeight)));
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
