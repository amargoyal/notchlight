/**
 * Where the cutout is, measured rather than guessed.
 *
 * The Swift probe is installed from the shipped prebuilt or compiled on first
 * run into ~/.notchlight/bin (see helpers.ts). With neither, the whole thing
 * degrades to the configured fallback width, which is wrong by a few points
 * and still perfectly usable.
 */
import { execFileSync } from 'node:child_process';
import { ensureHelperSync } from './helpers';

export interface NotchProbe {
  notch: boolean;
  notchW?: number;
  notchH?: number;
  screenW?: number;
  menuBarH?: number;
  /** The built-in display is attached — tells a Mac mini from a shut lid. */
  builtin?: boolean;
}

/** Prebuilt when the packaged app ships one for this source; compiled otherwise. */
function ensureBinary(): string | null {
  return ensureHelperSync('notchprobe');
}

/**
 * Three answers, not two. `no` is this hardware has no cutout; `unknown` is we
 * could not look. Collapsing them would make Notchlight refuse to run on a
 * notched MacBook that just lacks the Xcode command line tools.
 */
export type NotchState = 'yes' | 'no' | 'unknown';

let cached: NotchProbe | null | undefined;
let state: NotchState = 'unknown';

export function probeNotch(): NotchProbe | null {
  if (cached !== undefined) return cached;
  cached = null;
  state = 'unknown';
  const bin = ensureBinary();
  if (!bin) return cached;
  try {
    const parsed = JSON.parse(execFileSync(bin, { encoding: 'utf8', timeout: 8000 }).trim()) as NotchProbe;
    state = parsed.notch ? 'yes' : 'no';
    cached = parsed.notch ? parsed : null;
  } catch {
    cached = null;
    state = 'unknown';
  }
  return cached;
}

export function notchState(): NotchState {
  probeNotch();
  return state;
}

/** Displays change under us; a measurement belongs to one screen at one mode. */
export function resetProbe(): void {
  cached = undefined;
  state = 'unknown';
}
