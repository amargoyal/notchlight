/**
 * Tokens per second, as a small line.
 *
 * The daemon reports a session's running token total with every snapshot.
 * Differences between snapshots, per second, make a rate; the last minute of
 * rates makes a sparkline. Kept per session in a module map so the line
 * survives the panel closing and reopening, and trimmed when a session goes.
 */
export interface RatePoint { at: number; rate: number }

const WINDOW_MS = 60_000;
const MAX_POINTS = 60;
const history = new Map<string, { tokens: number; at: number; points: RatePoint[] }>();

/** Feed one observation; returns the points for the last minute, oldest first. */
export function observeTokens(sessionId: string, tokens: number, at: number): RatePoint[] {
  let entry = history.get(sessionId);
  if (!entry) { entry = { tokens, at, points: [] }; history.set(sessionId, entry); return entry.points; }
  const elapsed = (at - entry.at) / 1000;
  if (elapsed >= 1) {
    const rate = Math.max(0, (tokens - entry.tokens) / elapsed);
    entry.points.push({ at, rate });
    entry.tokens = tokens; entry.at = at;
    entry.points = entry.points.filter(p => at - p.at <= WINDOW_MS).slice(-MAX_POINTS);
  }
  return entry.points;
}

export function forgetTokens(keep: Set<string>): void {
  for (const id of [...history.keys()]) if (!keep.has(id)) history.delete(id);
}

/** An SVG path for the points, scaled to the box; empty for fewer than two points. */
export function sparklinePath(points: RatePoint[], width: number, height: number): string {
  if (points.length < 2) return '';
  const peak = Math.max(1, ...points.map(p => p.rate));
  const first = points[0].at, span = Math.max(1, points[points.length - 1].at - first);
  return points.map((p, i) => `${i ? 'L' : 'M'}${((p.at - first) / span * width).toFixed(1)},${(height - (p.rate / peak) * (height - 1) - 0.5).toFixed(1)}`).join(' ');
}

/** "1.2k/s" for the latest rate, or "" while there is nothing to say. */
export function rateLabel(points: RatePoint[]): string {
  const rate = points[points.length - 1]?.rate ?? 0;
  if (!points.length) return '';
  return rate >= 1000 ? `${(rate / 1000).toFixed(1)}k/s` : `${Math.round(rate)}/s`;
}
