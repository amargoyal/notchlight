/**
 * Real levels for the music wing.
 *
 * A Swift helper taps Spotify's own audio output through Core Audio and streams
 * five band levels a few dozen times a second. It is compiled on first use into
 * ~/.notchlight/bin, the same way the notch probe is, and runs only while
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
import { APP_DIR, ensureDir } from './config';
import { logEvent } from './lifecycle';

const BIN = path.join(APP_DIR, 'bin', 'audiotap');
const BARS = 5;
/** dist/main/index.js → ../../native/audiotap.swift */
const source = () => path.join(__dirname, '..', '..', 'native', 'audiotap.swift');

export type AudioLevelsStatus = 'idle' | 'starting' | 'listening' | 'unavailable';
/**
 * Why capture is unavailable, in the app's words rather than the helper's.
 * `permission` is the one the user can act on; the rest are circumstances.
 */
export type AudioLevelsReason = 'permission' | 'not-running' | 'unsupported' | 'no-output' | 'no-helper' | 'crashed' | 'failed';

/** The helper's first-line reason, or its exit, as a reason the settings pane can explain. */
export function captureReason(head: string | undefined): AudioLevelsReason {
  if (!head) return 'crashed';
  if (head === 'not-running') return 'not-running';
  if (head.startsWith('needs-macos')) return 'unsupported';
  if (head === 'no-output-device') return 'no-output';
  // 'nope' — kAudioHardwareIllegalOperationError — is what a refused or unanswered
  // capture prompt looks like from outside; the tap is the only step that asks.
  if (head === 'tap-1852797029' || head === 'tap-2003332927') return 'permission';
  return 'failed';
}

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
  /** Set while unavailable; cleared on every other status. */
  reason: AudioLevelsReason | null = null;
  /** Helper processes spawned so far. The native checks watch this stay flat while nothing changes. */
  starts = 0;
  constructor(private locate: () => Promise<string | null> = compile) { super(); }

  /** Start or stop listening. Safe to call on every state change; it only acts on the edges. */
  setActive(active: boolean): void {
    this.wanted = active;
    if (!active) { this.cancelRetry(); this.kill(); return; }
    if (this.child || this.status === 'starting') return;
    if (Date.now() < this.retryAt) { this.scheduleRetry(); return; }
    void this.start();
  }

  stop(): void { this.wanted = false; this.cancelRetry(); this.kill(); }

  /** When the next automatic attempt is due while unavailable, or null. */
  nextRetry(): number | null { return this.status === 'unavailable' && Number.isFinite(this.retryAt) ? this.retryAt : null; }

  private setStatus(status: AudioLevelsStatus, reason: AudioLevelsReason | null = null) {
    if (this.status === status && this.reason === reason) return;
    logEvent('levels', `${this.status} → ${status}${reason ? ` (${reason})` : ''}`);
    this.status = status;
    this.reason = status === 'unavailable' ? reason : null;
    this.emit('status', status, this.reason);
  }

  /**
   * Try again at `retryAt` if still wanted. The timer survives `kill()` on
   * purpose: a refusal kills the helper and must still come back later, or a
   * prompt answered a minute after it appeared would never take effect.
   */
  private scheduleRetry() {
    if (this.retryTimer || !Number.isFinite(this.retryAt)) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.wanted) this.setActive(true); }, Math.max(250, this.retryAt - Date.now()));
  }

  private cancelRetry() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  /** Give up for a while; a refused prompt or a missing Spotify is not worth hammering. */
  private backOff(ms: number, reason: AudioLevelsReason) {
    this.retryAt = Date.now() + ms;
    this.setStatus('unavailable', reason);
    if (this.wanted) this.scheduleRetry();
  }

  private async start(): Promise<void> {
    const generation = ++this.generation;
    this.setStatus('starting');
    this.binary ??= this.locate();
    const bin = await this.binary;
    if (generation !== this.generation) return;
    if (!bin) { this.retryAt = Infinity; this.setStatus('unavailable', 'no-helper'); return; }
    if (!this.wanted) { this.setStatus('idle'); return; }
    let child: ChildProcess;
    try { child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { this.backOff(60_000, 'crashed'); return; }
    this.child = child;
    this.starts++;
    logEvent('levels', `helper start #${this.starts} pid ${child.pid ?? '?'}`);
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
        logEvent('levels', `helper refused: ${head.reason ?? 'no status line'}`);
        const reason = captureReason(head.reason);
        this.backOff(reason === 'not-running' ? 5_000 : 60_000, reason);
        this.kill();
        return;
      }
      const levels = line.split(' ', BARS).map(Number);
      if (levels.length === BARS && levels.every(Number.isFinite)) this.emit('levels', levels);
    });
    child.on('error', () => { if (this.child === child) { this.child = null; this.backOff(60_000, 'crashed'); } });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      logEvent('levels', `helper exit ${signal ?? code ?? '?'} while ${this.status}`);
      // Gone before it said anything: a broken binary, not a device change. Wait, do not spin.
      if (first) { this.backOff(15_000, 'crashed'); return; }
      if (this.status === 'listening') this.setStatus('idle');
      // A clean exit while still wanted is the output device changing under us: come back on the new one.
      if (this.wanted && this.status !== 'unavailable') { this.retryAt = Date.now() + 750; this.scheduleRetry(); }
    });
  }

  private kill() {
    this.generation++;
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
