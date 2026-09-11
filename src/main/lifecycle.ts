/**
 * One line per thing that happened to the process.
 *
 * The native checks in docs/native-checks.md read the service log to confirm
 * that a sleep, a wake, a display change or a helper start was actually seen
 * by the app, so every line here has a stable shape: an ISO timestamp, a
 * bracketed tag and a short message. `scripts/native-check.mjs` counts them.
 */
export type LifecycleTag = 'power' | 'display' | 'levels' | 'spotify' | 'hooks' | 'island' | 'updates' | 'notchlight';

export function logEvent(tag: LifecycleTag, message: string): void {
  console.log(`${new Date().toISOString()} [${tag}] ${message}`);
}

/** The shape a log line takes, so readers and writers agree on it. */
export const LIFECYCLE_LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[([a-z]+)\] (.*)$/;

export function parseLifecycleLine(line: string): { at: number; tag: string; message: string } | null {
  const match = LIFECYCLE_LINE.exec(line);
  if (!match) return null;
  const at = Date.parse(match[1]);
  return Number.isFinite(at) ? { at, tag: match[2], message: match[3] } : null;
}
