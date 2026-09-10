/**
 * Instant word of a change inside Spotify.
 *
 * A small Swift helper listens for Spotify's own PlaybackStateChanged
 * notification and prints one JSON line per change. The player applies what
 * the line carries at once — play, pause, skip, seek, the new track's name —
 * and reads the full status right after for what it does not, artwork mostly.
 *
 * Runs only while Spotify is connected. If the helper cannot be built or
 * keeps dying, polling carries on at its usual pace and nothing is lost but
 * the immediacy.
 */
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { ensureHelper } from './helpers';
import { logEvent } from './lifecycle';

export interface PlaybackChange {
  playing: boolean;
  trackId?: string;
  position?: number;
  durationMs?: number;
  title?: string;
  artist?: string;
  album?: string;
}

const str = (v: unknown) => typeof v === 'string' ? v.slice(0, 2000) : undefined;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** One helper line into a change, or null if it is not one. */
export function parsePlaybackChange(line: string): PlaybackChange | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(line); } catch { return null; }
  if (!raw || typeof raw !== 'object' || typeof raw.state !== 'string') return null;
  return { playing: raw.state === 'Playing', trackId: str(raw.trackId), position: num(raw.position), durationMs: num(raw.durationMs), title: str(raw.title), artist: str(raw.artist), album: str(raw.album) };
}

export class SpotifyWatcher extends EventEmitter {
  private child: ChildProcess | null = null;
  private wanted = false;
  private binary: Promise<string | null> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private generation = 0;
  listening = false;
  starts = 0;
  constructor(private locate: () => Promise<string | null> = () => ensureHelper('spotifywatch')) { super(); }

  setActive(active: boolean): void {
    this.wanted = active;
    if (!active) { this.kill(); return; }
    if (this.child || this.retryTimer) return;
    void this.start();
  }

  stop(): void { this.setActive(false); }

  private setListening(listening: boolean) {
    if (this.listening === listening) return;
    this.listening = listening;
    logEvent('spotify', listening ? 'watcher listening' : 'watcher gone');
    this.emit('listening', listening);
  }

  private async start(): Promise<void> {
    const generation = ++this.generation;
    this.binary ??= this.locate();
    const bin = await this.binary;
    if (generation !== this.generation || !this.wanted) return;
    if (!bin) { logEvent('spotify', 'watcher unavailable: no helper'); return; }
    let child: ChildProcess;
    try { child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { this.retryLater(); return; }
    this.child = child;
    this.starts++;
    logEvent('spotify', `watcher start #${this.starts} pid ${child.pid ?? '?'}`);
    let first = true;
    readline.createInterface({ input: child.stdout! }).on('line', line => {
      if (this.child !== child) return;
      if (first) { first = false; this.failures = 0; this.setListening(true); return; }
      const change = parsePlaybackChange(line);
      if (change) this.emit('change', change);
    });
    child.on('error', () => { if (this.child === child) { this.child = null; this.setListening(false); this.retryLater(); } });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      this.setListening(false);
      if (this.wanted) this.retryLater();
    });
  }

  /** 5 s, 10 s, 20 s, 40 s, then a minute between attempts. */
  private retryLater() {
    if (this.retryTimer) return;
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(4, this.failures++));
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.wanted) void this.start(); }, delay);
  }

  private kill() {
    this.generation++;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const child = this.child;
    this.child = null;
    this.setListening(false);
    if (!child) return;
    try { child.stdin?.end(); } catch { /* already gone */ }
    const force = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* already gone */ } }, 500);
    child.once('exit', () => clearTimeout(force));
  }
}
