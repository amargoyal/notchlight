/**
 * Where the cutouts are, measured rather than guessed.
 *
 * The Swift probe is installed from the shipped prebuilt or compiled on first
 * run into ~/.notchlight/bin (see helpers.ts). With neither, the whole thing
 * degrades to the configured fallback width, which is wrong by a few points
 * and still perfectly usable.
 *
 * Every attached screen is measured, because the island can be asked to appear
 * on all of them. The probe reports each screen's CGDirectDisplayID, which is
 * what Electron calls a Display's id, so a measurement belongs to one screen by
 * name rather than by being the same width as it.
 */
import { execFileSync } from 'node:child_process';
import { ensureHelperSync } from './helpers';

/** One screen, as the probe found it. */
export interface DisplayProbe {
  id: number;
  name: string;
  /** The built-in panel — tells a Mac mini from a shut lid. */
  builtin: boolean;
  notch: boolean;
  notchW?: number;
  notchH?: number;
  screenW: number;
  menuBarH: number;
}

/** Prebuilt when the packaged app ships one for this source; compiled otherwise. */
function ensureBinary(): string | null {
  return ensureHelperSync('notchprobe');
}

/**
 * Three answers, not two. `no` is no attached screen has a cutout; `unknown` is
 * we could not look. Collapsing them would make Notchlight refuse to run on a
 * notched MacBook that just lacks the Xcode command line tools.
 */
export type NotchState = 'yes' | 'no' | 'unknown';

let cached: DisplayProbe[] | undefined;
let state: NotchState = 'unknown';

const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** One entry of the probe's list, or null when it is not usable. */
export function parseDisplayProbe(raw: unknown): DisplayProbe | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = number(item.id);
  const screenW = number(item.screenW);
  if (id === undefined || screenW === undefined) return null;
  const notchW = number(item.notchW);
  const notchH = number(item.notchH);
  const notch = item.notch === true && notchW !== undefined && notchW > 0 && notchH !== undefined && notchH > 0;
  return {
    id, screenW,
    name: typeof item.name === 'string' && item.name ? item.name : `Display ${id}`,
    builtin: item.builtin === true,
    menuBarH: number(item.menuBarH) ?? 0,
    notch, ...(notch ? { notchW, notchH } : {})
  };
}

/** Every attached screen, measured. Empty when the probe could not run. */
export function probeDisplays(): DisplayProbe[] {
  if (cached !== undefined) return cached;
  state = 'unknown';
  const bin = ensureBinary();
  if (!bin) return (cached = []);
  try {
    const parsed = JSON.parse(execFileSync(bin, { encoding: 'utf8', timeout: 8000 }).trim());
    const list: unknown[] = Array.isArray(parsed?.displays) ? parsed.displays : [];
    const found = list.map(parseDisplayProbe).filter((d): d is DisplayProbe => d !== null);
    state = found.some(d => d.notch) ? 'yes' : 'no';
    return (cached = found);
  } catch {
    state = 'unknown';
    return (cached = []);
  }
}

/** One screen's measurement, by Electron display id. */
export function probeFor(id: number): DisplayProbe | null {
  return probeDisplays().find(d => d.id === id) ?? null;
}

/** The notched screen, when exactly one of them has a cutout. */
export function probeNotch(): DisplayProbe | null {
  const notched = probeDisplays().filter(d => d.notch);
  return notched.find(d => d.builtin) ?? notched[0] ?? null;
}

export function notchState(): NotchState {
  probeDisplays();
  return state;
}

/** Displays change under us; a measurement belongs to one screen at one mode. */
export function resetProbe(): void {
  cached = undefined;
  state = 'unknown';
}
