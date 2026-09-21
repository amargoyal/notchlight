/**
 * A long-running helper that talks in lines.
 *
 * Several helpers share one shape: a Swift binary that prints a JSON status
 * line, then one line per event, and exits when stdin closes. This supervises
 * one of those — build or install it, start it, hand each line to a parser,
 * say when it is listening, and come back with a growing delay if it dies.
 */
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { ensureHelper, type HelperName } from './helpers';
import { logEvent, type LifecycleTag } from './lifecycle';

export class LineHelper<T> extends EventEmitter {
  private child: ChildProcess | null = null;
  private wanted = false;
  private binary: Promise<string | null> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private generation = 0;
  listening = false;
  starts = 0;

  constructor(
    private name: HelperName,
    private parse: (line: string) => T | null,
    private tag: LifecycleTag = 'notchlight',
    private locate: () => Promise<string | null> = () => ensureHelper(name),
    private args: string[] = []
  ) { super(); }

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
    logEvent(this.tag, `${this.name} ${listening ? 'listening' : 'gone'}`);
    this.emit('listening', listening);
  }

  private async start(): Promise<void> {
    const generation = ++this.generation;
    this.binary ??= this.locate();
    const bin = await this.binary;
    if (generation !== this.generation || !this.wanted) return;
    if (!bin) { logEvent(this.tag, `${this.name} unavailable: no helper`); return; }
    let child: ChildProcess;
    try { child = spawn(bin, this.args, { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { this.retryLater(); return; }
    this.child = child;
    this.starts++;
    logEvent(this.tag, `${this.name} start #${this.starts} pid ${child.pid ?? '?'}`);
    let first = true;
    readline.createInterface({ input: child.stdout! }).on('line', line => {
      if (this.child !== child) return;
      if (first) { first = false; this.failures = 0; this.setListening(true); this.emit('ready', line); return; }
      const event = this.parse(line);
      if (event !== null) this.emit('event', event);
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

export interface PasteboardChange { change: number; types: string[]; concealed: boolean }

/** What a key press did: the level it landed on, 0…1, and mute for the volume. */
export interface HudEvent { kind: 'volume' | 'brightness'; value: number; muted: boolean }

/** One hudwatch line into a change, or null. */
export function parseHudEvent(line: string): HudEvent | null {
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind !== 'volume' && raw.kind !== 'brightness') return null;
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return null;
    return { kind: raw.kind, value: Math.max(0, Math.min(1, raw.value)), muted: raw.muted === true };
  } catch { return null; }
}

/** What the battery is doing, as powerwatch reports it. */
export interface PowerEvent { percent: number; charging: boolean; plugged: boolean; charged: boolean; minutes: number | null }

/** One powerwatch line into a reading, or null. */
export function parsePowerEvent(line: string): PowerEvent | null {
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.percent !== 'number' || !Number.isFinite(raw.percent)) return null;
    const minutes = typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) && raw.minutes > 0 ? Math.round(raw.minutes) : null;
    return { percent: Math.max(0, Math.min(1, raw.percent)), charging: raw.charging === true, plugged: raw.plugged === true, charged: raw.charged === true, minutes };
  } catch { return null; }
}

/** One pasteboardwatch line into a change, or null. */
export function parsePasteboardChange(line: string): PasteboardChange | null {
  try {
    const raw = JSON.parse(line);
    if (!raw || typeof raw !== 'object' || typeof raw.change !== 'number' || !Array.isArray(raw.types)) return null;
    return { change: raw.change, types: raw.types.filter((t: unknown): t is string => typeof t === 'string'), concealed: raw.concealed === true };
  } catch { return null; }
}
