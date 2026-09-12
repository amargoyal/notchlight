/**
 * Which Claude Code sessions are actually still open.
 *
 * Nothing on disk answers this. Closing a terminal window kills `claude` with a
 * signal, so the transcript simply stops — which is byte for byte what an idle
 * session waiting for you to type looks like. Timing cannot tell them apart at
 * any threshold, and a session you shut an hour ago went on burning a light on
 * the notch.
 *
 * So ask the process table. `claude` runs as a process of that name, and its
 * working directory is the project directory the session belongs to, which is
 * the same `cwd` the transcript records. That gives a count per directory:
 * two live processes in ~/dev/thing means at most two of the session files
 * there are still open, newest first.
 *
 * The count is the fallback, not the whole story. The process does not carry
 * its session id, but the hook client does carry its own parent — the `claude`
 * that ran it — so any session that has been heard from over a hook can be
 * matched to a pid exactly. `hasPid` answers that, and the count only decides
 * the sessions no hook has ever named.
 *
 * Everything here fails open. If the scan cannot run it reports that it could
 * not tell and the caller hides nothing. Finding nothing is different: it only
 * means the probe is blind if no `claude` has ever been resolved during this
 * run, which is what `sawAgents` is for. Once one has been seen the probe is
 * known to work on this machine, and a later zero is simply zero.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Transcripts retain shell aliases; lsof reports the physical directory. */
export function directoryKey(cwd: string): string {
  try { return fs.realpathSync.native(cwd); }
  catch { return path.resolve(cwd); }
}

/** Belt and braces: the probe must never become the reason the app stalls. */
const SCAN_TIMEOUT_MS = 4000;

export class Liveness {
  /** Directory → number of live `claude` processes in it. */
  private counts = new Map<string, number>();
  /** Directory → the agent processes in it, by name, for jumping back to one. */
  private pids = new Map<string, { pid: number; name: string }[]>();
  private names = new Map<string, string>();
  private known = false;
  /** True once a scan has resolved at least one `claude` process this run. */
  private seen = false;
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  // Three seconds, not five: with `hasPid` the scan is the whole latency of a
  // closed window going dark, so the interval is what the delay feels like.
  start(intervalMs = 3000): void {
    this.scan();
    this.timer = setInterval(() => this.scan(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** How many sessions can still be open in this directory. */
  countFor(cwd: string): number {
    return this.counts.get(directoryKey(cwd)) ?? 0;
  }

  /** The pids of `name` processes in this directory, highest (newest) first. */
  pidsFor(cwd: string, name: 'claude' | 'codex'): number[] {
    return (this.pids.get(directoryKey(cwd)) ?? []).filter(p => p.name === name).map(p => p.pid).sort((a, b) => b - a);
  }

  /**
   * Is this pid a live `claude` right now?
   *
   * The one piece of real identity available. The process does not carry its
   * session id, but a hook does carry its process id — `process.ppid` of the
   * hook client is the `claude` that ran it — so a session that has been heard
   * from over a hook can be matched to a row in the process table exactly,
   * rather than through the count for its directory.
   */
  hasPid(pid: number): boolean {
    return this.names.get(String(pid)) === 'claude';
  }

  /**
   * Has a `claude` process ever been resolved during this run?
   *
   * This is what separates "you closed everything" from "this probe cannot see
   * `claude` on this machine at all" — a wrapper script, a container, a rename.
   * Once one has been seen, the probe is known to work here and a later total
   * of zero is a fact rather than a blind spot.
   */
  sawAgents(): boolean {
    return this.seen;
  }

  /** Total live processes seen. Zero with `reliable()` means everything closed. */
  total(): number {
    let n = 0;
    for (const c of this.counts.values()) n += c;
    return n;
  }

  /** False until a scan has succeeded. Callers must hide nothing while false. */
  reliable(): boolean {
    return this.known;
  }

  private scan(): void {
    if (this.scanning) return;
    this.scanning = true;
    // Everything is spawned rather than run synchronously: this sits behind a
    // timer on the main process, and a wedged `lsof` freezing the island would
    // be a far worse bug than a stale light.
    execFile('ps', ['-Ao', 'pid=,uid=,comm='], { timeout: SCAN_TIMEOUT_MS }, (err, out) => {
      if (err) {
        this.scanning = false;
        this.known = false;
        return;
      }
      const uid = process.getuid?.() ?? -1;
      const pids: string[] = [];
      const names = new Map<string, string>();
      for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (!m) continue;
        if (Number(m[2]) !== uid) continue;
        const comm = m[3].trim();
        // `comm` is the executable, not the command line — a `claude` launched
        // through a shim still reports its own name here. `codex` is only
        // remembered for jumping back to it; it never counts as a session.
        const name = comm === 'claude' || comm.endsWith('/claude') ? 'claude' : comm === 'codex' || comm.endsWith('/codex') ? 'codex' : null;
        if (!name) continue;
        pids.push(m[1]);
        names.set(m[1], name);
      }
      this.names = names;
      for (const n of names.values()) {
        if (n !== 'claude') continue;
        this.seen = true;
        break;
      }
      if (!pids.length) {
        this.counts.clear();
        this.pids.clear();
        this.known = true;
        this.scanning = false;
        return;
      }
      this.readCwds(pids);
    });
  }

  private readCwds(pids: string[]): void {
    // One lsof for every pid at once. `-Fpn` prints `p<pid>` then `n<path>`.
    execFile(
      'lsof',
      ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')],
      { timeout: SCAN_TIMEOUT_MS },
      (err, out) => {
        this.scanning = false;
        // lsof exits non-zero when some pid has already gone. That is normal
        // here and the output for the rest is still good, so only a total
        // absence of output counts as a failure.
        if (!out || !out.trim()) {
          if (err) this.known = false;
          return;
        }
        const next = new Map<string, number>();
        const located = new Map<string, { pid: number; name: string }[]>();
        let current = 0;
        for (const line of out.split('\n')) {
          if (line.startsWith('p')) { current = Number(line.slice(1)); continue; }
          if (line.startsWith('n')) {
            const dir = line.slice(1).trim();
            if (dir) {
              const key = directoryKey(dir);
              const name = this.names.get(String(current)) ?? 'claude';
              if (name === 'claude') {
                next.set(key, (next.get(key) ?? 0) + 1);
                this.seen = true;
              }
              located.set(key, [...(located.get(key) ?? []), { pid: current, name }]);
            }
          }
        }
        this.counts = next;
        this.pids = located;
        this.known = true;
      }
    );
  }
}
