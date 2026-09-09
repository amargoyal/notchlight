/**
 * Real levels for the music wing.
 *
 * A Swift helper taps Spotify's own audio output through Core Audio and streams
 * five band levels a few dozen times a second. It is compiled on first use into
 * ~/.claude-light/bin, the same way the notch probe is, and runs only while
 * something is actually playing and the bars are on screen.
 *
 * Everything here degrades quietly. No swiftc, an older macOS, a refused audio
 * capture prompt, Spotify playing to another room — the bars fall back to their
 * gentle canned rhythm and nothing else changes.
 */
import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CL_DIR, ensureDir } from './config';

const BIN = path.join(CL_DIR, 'bin', 'audiotap');
const BARS = 5;
/** dist/main/index.js → ../../native/audiotap.swift */
const source = () => path.join(__dirname, '..', '..', 'native', 'audiotap.swift');

export type AudioLevelsStatus = 'idle' | 'starting' | 'listening' | 'unavailable';

function compile(): Promise<string | null> {
  return new Promise(resolve => {
    const SOURCE = source();
    try {
      if (!fs.existsSync(SOURCE)) return resolve(null);
      if (fs.existsSync(BIN) && fs.statSync(BIN).mtimeMs > fs.statSync(SOURCE).mtimeMs) return resolve(BIN);
      ensureDir();
      fs.mkdirSync(path.dirname(BIN), { recursive: true });
    } catch { return resolve(null); }
    execFile('swiftc', ['-O', '-o', BIN, SOURCE], { timeout: 120_000 }, error => resolve(error ? null : BIN));
  });
}

export class AudioLevels extends EventEmitter {
  private child: ChildProcess | null = null;
  private wanted = false;
  private binary: Promise<string | null> | null = null;
  private retryAt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  status: AudioLevelsStatus = 'idle';
  constructor(private locate: () => Promise<string | null> = compile) { super(); }

  /** Start or stop listening. Safe to call on every state change; it only acts on the edges. */
  setActive(active: boolean): void {
    this.wanted = active;
    if (!active) { this.kill(); return; }
    if (this.child || this.status === 'starting') return;
    if (Date.now() < this.retryAt) { this.scheduleRetry(); return; }
    void this.start();
  }

  stop(): void { this.wanted = false; this.kill(); }

  private setStatus(status: AudioLevelsStatus) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  private scheduleRetry() {
    if (this.retryTimer || !Number.isFinite(this.retryAt)) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.wanted) this.setActive(true); }, Math.max(250, this.retryAt - Date.now()));
  }

  /** Give up for a while; a refused prompt or a missing Spotify is not worth hammering. */
  private backOff(ms: number) {
    this.retryAt = Date.now() + ms;
    this.setStatus('unavailable');
    if (this.wanted) this.scheduleRetry();
  }

  private async start(): Promise<void> {
    const generation = ++this.generation;
    this.setStatus('starting');
    this.binary ??= this.locate();
    const bin = await this.binary;
    if (generation !== this.generation) return;
    if (!bin) { this.retryAt = Infinity; this.setStatus('unavailable'); return; }
    if (!this.wanted) { this.setStatus('idle'); return; }
    let child: ChildProcess;
    try { child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { this.backOff(60_000); return; }
    this.child = child;
    let first = true;
    const lines = readline.createInterface({ input: child.stdout! });
    lines.on('line', line => {
      if (this.child !== child) return;
      if (first) {
        first = false;
        let head: { ok?: boolean; reason?: string } = {};
        try { head = JSON.parse(line); } catch { /* treated as a refusal below */ }
        if (head.ok) { this.setStatus('listening'); return; }
        // Spotify not open is momentary; anything else is the OS saying no, so wait longer.
        this.backOff(head.reason === 'not-running' ? 5_000 : 60_000);
        this.kill();
        return;
      }
      const levels = line.split(' ', BARS).map(Number);
      if (levels.length === BARS && levels.every(Number.isFinite)) this.emit('levels', levels);
    });
    child.on('error', () => { if (this.child === child) { this.child = null; this.backOff(60_000); } });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      if (this.status === 'listening') this.setStatus('idle');
      // A clean exit while still wanted is the output device changing under us: come back on the new one.
      if (this.wanted && this.status !== 'unavailable') { this.retryAt = Date.now() + 750; this.scheduleRetry(); }
    });
  }

  private kill() {
    this.generation++;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const child = this.child;
    this.child = null;
    if (this.status !== 'unavailable') this.setStatus('idle');
    if (!child) return;
    // Closing stdin is the polite ask; the helper exits on EOF. SIGTERM is the backstop.
    try { child.stdin?.end(); } catch { /* already gone */ }
    const force = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* already gone */ } }, 500);
    child.once('exit', () => clearTimeout(force));
  }
}

/** The bars are worth a helper process only when they are visible and would move. */
export function wantsLevels(state: { preferences: { spotifyEnabled: boolean; visualizer: boolean; reducedMotion: boolean }; view: string; music: { status: string; playing: boolean } }): boolean {
  const { preferences, view, music } = state;
  return preferences.spotifyEnabled && preferences.visualizer && !preferences.reducedMotion && view === 'music' && music.status === 'ready' && music.playing;
}
